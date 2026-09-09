"use client";

/**
 * Formulaire guidé de bon de commande :
 * 1. choix du modèle (composition affichée),
 * 2. une section par fiche à remplir (champs custom du type + date si planning),
 * 3. compte Instagram cible + notes, puis soumission → /commandes/[id].
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { toast } from "@/components/ui/Toast";
import { DateTimeField } from "@/components/ui/molecules/DateTimeField";
import { isPastLocalInput, localInputToIso } from "@/lib/date/formatFr";
import { CustomFieldValueInput } from "@/components/fields/CustomFieldValueInput";
import type { CustomField } from "@/lib/customFields";

export interface OrderTemplateOption {
  id: string;
  name: string;
  description: string | null;
  items: {
    entityTypeId: string;
    typeName: string;
    hasPlanning: boolean;
    hasAccount: boolean;
    fieldSchema: CustomField[];
  }[];
  videoSummary: string;
  videoCount: number;
}

interface NewOrderClientProps {
  templates: OrderTemplateOption[];
  accounts: { id: string; name: string; handle: string; clientId: string | null }[];
  clients: { id: string; name: string }[];
  isAdmin: boolean;
}

interface FicheDraft {
  label: string;
  fields: Record<string, string>;
  scheduledAt: string;
}

export function NewOrderClient({ templates, accounts, clients, isAdmin }: NewOrderClientProps) {
  const router = useRouter();
  const [templateId, setTemplateId] = useState<string>("");
  const [clientId, setClientId] = useState<string>("");
  const [accountId, setAccountId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [fiches, setFiches] = useState<Record<string, FicheDraft>>({});
  const [submitting, setSubmitting] = useState(false);
  // Erreurs par champ : le formulaire est long, un toast seul oblige à
  // chercher lequel des ~12 champs est en cause.
  const [errors, setErrors] = useState<Record<string, string>>({});

  const template = templates.find((t) => t.id === templateId) ?? null;

  const visibleAccounts = useMemo(
    () => (isAdmin ? accounts.filter((a) => a.clientId === clientId) : accounts),
    [accounts, clientId, isAdmin],
  );
  const needsAccount = template?.items.some((i) => i.hasAccount) ?? false;
  // Un seul compte disponible → présélection.
  const effectiveAccountId =
    accountId || (visibleAccounts.length === 1 ? visibleAccounts[0].id : "");

  function selectTemplate(id: string) {
    // Re-clic sur le modèle déjà sélectionné : ne pas purger les saisies.
    if (id === templateId) return;
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    setFiches(
      Object.fromEntries(
        (t?.items ?? []).map((i) => [
          i.entityTypeId,
          { label: "", fields: {}, scheduledAt: "" },
        ]),
      ),
    );
  }

  /**
   * Libellé des fiches secondaires — dérivé de la première, jamais saisi.
   * Doit rester identique au calcul de `createOrder`, qui fait foi.
   */
  function derivedLabel(typeName: string): string {
    const primaryTypeId = template?.items[0]?.entityTypeId;
    const primary = primaryTypeId ? (fiches[primaryTypeId]?.label ?? "").trim() : "";
    return primary ? `${typeName} — ${primary}` : "";
  }

  function patchFiche(entityTypeId: string, patch: Partial<FicheDraft>) {
    setFiches((prev) => ({
      ...prev,
      [entityTypeId]: { ...prev[entityTypeId], ...patch },
    }));
    setErrors((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(patch)) delete next[`${entityTypeId}:${key}`];
      if (patch.fields) {
        for (const k of Object.keys(next)) {
          if (k.startsWith(`${entityTypeId}:field:`)) delete next[k];
        }
      }
      return next;
    });
  }

  async function handleSubmit() {
    if (!template) return;

    // Une passe complète : l'utilisateur voit tout ce qui manque d'un coup,
    // au lieu de re-soumettre autant de fois qu'il y a de champs vides.
    const found: Record<string, string> = {};
    if (isAdmin && !clientId) found.client = "Choisissez un client.";
    for (const [index, item] of template.items.entries()) {
      const draft = fiches[item.entityTypeId];
      // Les fiches suivantes tirent leur libellé de la première.
      if (index === 0 && !draft?.label.trim()) {
        found[`${item.entityTypeId}:label`] = "Libellé requis.";
      }
      if (item.hasPlanning && !draft?.scheduledAt) {
        found[`${item.entityTypeId}:scheduledAt`] = "Date requise.";
      }
      for (const field of item.fieldSchema) {
        if (field.required && !(draft?.fields[field.key] ?? "").trim()) {
          found[`${item.entityTypeId}:field:${field.key}`] = "Champ requis.";
        }
      }
    }
    if (needsAccount && !effectiveAccountId) found.account = "Choisissez un compte Instagram.";

    setErrors(found);
    const missing = Object.keys(found).length;
    if (missing > 0) {
      toast.error(
        missing === 1
          ? "Un champ obligatoire est manquant — il est signalé en rouge."
          : `${missing} champs obligatoires sont manquants — ils sont signalés en rouge.`,
      );
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderTemplateId: template.id,
          accountId: effectiveAccountId || null,
          notes: notes.trim() || null,
          clientId: isAdmin ? clientId : undefined,
          fiches: template.items.map((item, index) => {
            const draft = fiches[item.entityTypeId];
            return {
              entityTypeId: item.entityTypeId,
              // Dérivé côté serveur pour les fiches suivantes ; envoyé pour que
              // la requête reste valide si le calcul évolue.
              label: index === 0 ? draft.label.trim() : derivedLabel(item.typeName),
              fields: draft.fields,
              scheduledAt:
                item.hasPlanning && draft.scheduledAt
                  ? localInputToIso(draft.scheduledAt)
                  : null,
            };
          }),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !data.id) {
        toast.error(data.error ?? "Échec de la soumission.");
        return;
      }
      toast.success("Commande soumise — l'équipe va la valider.");
      router.push(`/commandes/${data.id}`);
    } catch {
      toast.error("Erreur réseau.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="mb-6">
        <Breadcrumb
          className="mb-2"
          items={[
            { href: "/commandes", label: isAdmin ? "Commandes" : "Mes commandes" },
            { label: "Nouvelle commande" },
          ]}
        />
        <h1 className="text-xl font-semibold text-foreground leading-tight">Nouvelle commande</h1>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          Renseignez toutes les informations — l&apos;équipe valide puis lance la production.
        </p>
      </div>

      {templates.length === 0 ? (
        <Card>
          <p className="text-[13px] text-muted-foreground p-4">
            Aucun modèle de commande disponible pour votre agence — contactez l&apos;équipe.
          </p>
        </Card>
      ) : (
        <div className="space-y-5">
          {/* 1. Choix du modèle */}
          <div className="grid gap-3 sm:grid-cols-2">
            {templates.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => selectTemplate(t.id)}
                className={[
                  "text-left rounded-lg border p-4 transition-colors",
                  templateId === t.id
                    ? "border-primary bg-primary/5"
                    : "border-border bg-card hover:bg-muted",
                ].join(" ")}
              >
                <p className="text-[14px] font-medium text-foreground">{t.name}</p>
                {t.description && (
                  <p className="mt-1 text-[12px] text-muted-foreground">{t.description}</p>
                )}
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Fiches : {t.items.map((i) => i.typeName).join(" + ") || "—"}
                  {/* Les libellés de recettes (RVA2, RPI…) sont des codes de
                      production : parlants pour l'équipe, opaques pour l'agence
                      qui commande. Elle n'a besoin que du volume. */}
                  {isAdmin
                    ? t.videoSummary && <> · Vidéos : {t.videoSummary}</>
                    : t.videoCount > 0 && (
                        <>
                          {" "}
                          · {t.videoCount} vidéo{t.videoCount > 1 ? "s" : ""}
                        </>
                      )}
                </p>
              </button>
            ))}
          </div>

          {template && (
            <>
              {isAdmin && (
                <FormField
                  label="Client"
                  required
                  error={clientId ? undefined : errors.client}
                  help="Commande créée au nom de cette agence."
                >
                  <Select
                    value={clientId}
                    onChange={(v) => {
                      setClientId(v);
                      setAccountId("");
                      setErrors((prev) => {
                        const next = { ...prev };
                        delete next.client;
                        return next;
                      });
                    }}
                    options={clients.map((c) => ({ value: c.id, label: c.name }))}
                    placeholder="Choisir un client…"
                  />
                </FormField>
              )}

              {/* 2. Une section par fiche */}
              {template.items.map((item, idx) => {
                const draft = fiches[item.entityTypeId] ?? {
                  label: "",
                  fields: {},
                  scheduledAt: "",
                };
                return (
                  <div
                    key={item.entityTypeId}
                    className="bg-card border border-border rounded-lg p-4 space-y-3"
                  >
                    <p className="text-[13px] font-semibold text-foreground">
                      {idx + 1}. {item.typeName}
                    </p>
                    {idx === 0 ? (
                      <FormField
                        label="Libellé"
                        required
                        error={draft.label.trim() ? undefined : errors[`${item.entityTypeId}:label`]}
                        help="Sert de référence aux autres fiches de la commande."
                      >
                        <Input
                          value={draft.label}
                          onChange={(v) => patchFiche(item.entityTypeId, { label: v })}
                          placeholder={`Ex : ${item.typeName} — 12 rue des Lilas`}
                        />
                      </FormField>
                    ) : (
                      /* Dérivé de la première fiche : une seule saisie, et deux
                         fiches distinguables au lieu de deux homonymes. */
                      <FormField label="Libellé" help="Repris de la première fiche.">
                        <p className="text-[13px] text-muted-foreground bg-muted/50 border border-border rounded-md px-3 py-2">
                          {derivedLabel(item.typeName) || (
                            <span className="italic">
                              Renseignez le libellé de « {template.items[0].typeName} »
                            </span>
                          )}
                        </p>
                      </FormField>
                    )}
                    {item.hasPlanning && (
                      <FormField
                        label="Date souhaitée"
                        required
                        error={
                          draft.scheduledAt ? undefined : errors[`${item.entityTypeId}:scheduledAt`]
                        }
                        help="Date du tournage / de l'intervention — l'équipe confirme à la validation."
                      >
                        <>
                          <DateTimeField
                            value={draft.scheduledAt}
                            onChange={(v) => patchFiche(item.entityTypeId, { scheduledAt: v })}
                          />
                          {draft.scheduledAt && isPastLocalInput(draft.scheduledAt) && (
                            <p className="mt-1 text-[11px] text-warning-700">
                              Cette date est déjà passée — la fiche n&apos;apparaîtra pas dans le
                              planning de la semaine en cours.
                            </p>
                          )}
                        </>
                      </FormField>
                    )}
                    {item.fieldSchema.map((field) => (
                      <CustomFieldValueInput
                        key={field.key}
                        field={field}
                        value={draft.fields[field.key] ?? ""}
                        onChange={(v) =>
                          patchFiche(item.entityTypeId, {
                            fields: { ...draft.fields, [field.key]: v },
                          })
                        }
                        showLabel
                        error={
                          (draft.fields[field.key] ?? "").trim()
                            ? undefined
                            : errors[`${item.entityTypeId}:field:${field.key}`]
                        }
                      />
                    ))}
                    {item.fieldSchema.length === 0 && (
                      <p className="text-[12px] text-muted-foreground italic">
                        Aucun champ supplémentaire pour cette fiche.
                      </p>
                    )}
                  </div>
                );
              })}

              {/* 3. Compte + notes */}
              {(needsAccount || visibleAccounts.length > 0) && (
                <FormField
                  label="Compte Instagram"
                  required={needsAccount}
                  error={effectiveAccountId ? undefined : errors.account}
                  help="Compte sur lequel les vidéos seront publiées."
                >
                  <Select
                    value={effectiveAccountId}
                    onChange={(v) => {
                      setAccountId(v);
                      setErrors((prev) => {
                        const next = { ...prev };
                        delete next.account;
                        return next;
                      });
                    }}
                    options={visibleAccounts.map((a) => ({
                      value: a.id,
                      label: `${a.name} (@${a.handle})`,
                    }))}
                    placeholder={
                      visibleAccounts.length === 0
                        ? "Aucun compte disponible"
                        : "Choisir un compte…"
                    }
                    disabled={visibleAccounts.length === 0}
                  />
                </FormField>
              )}

              <FormField label="Notes" help="Précisions pour l'équipe (optionnel).">
                <Textarea value={notes} onChange={setNotes} rows={3} />
              </FormField>

              <div className="flex justify-end">
                <Button onClick={() => void handleSubmit()} disabled={submitting}>
                  {submitting ? "Soumission…" : "Soumettre la commande"}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
