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

  function patchFiche(entityTypeId: string, patch: Partial<FicheDraft>) {
    setFiches((prev) => ({
      ...prev,
      [entityTypeId]: { ...prev[entityTypeId], ...patch },
    }));
  }

  async function handleSubmit() {
    if (!template) return;
    if (isAdmin && !clientId) {
      toast.error("Choisissez un client.");
      return;
    }
    for (const item of template.items) {
      const draft = fiches[item.entityTypeId];
      if (!draft?.label.trim()) {
        toast.error(`Un libellé est requis pour « ${item.typeName} ».`);
        return;
      }
      if (item.hasPlanning && !draft.scheduledAt) {
        toast.error(`Une date est requise pour « ${item.typeName} ».`);
        return;
      }
      for (const field of item.fieldSchema) {
        if (field.required && !(draft.fields[field.key] ?? "").trim()) {
          toast.error(`Le champ « ${field.label} » est requis (${item.typeName}).`);
          return;
        }
      }
    }
    if (needsAccount && !effectiveAccountId) {
      toast.error("Choisissez un compte Instagram.");
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
          fiches: template.items.map((item) => {
            const draft = fiches[item.entityTypeId];
            return {
              entityTypeId: item.entityTypeId,
              label: draft.label.trim(),
              fields: draft.fields,
              scheduledAt:
                item.hasPlanning && draft.scheduledAt
                  ? new Date(draft.scheduledAt).toISOString()
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
                  {t.videoSummary && <> · Vidéos : {t.videoSummary}</>}
                </p>
              </button>
            ))}
          </div>

          {template && (
            <>
              {isAdmin && (
                <FormField label="Client" help="Commande créée au nom de cette agence.">
                  <Select
                    value={clientId}
                    onChange={(v) => {
                      setClientId(v);
                      setAccountId("");
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
                    <FormField label="Libellé">
                      <Input
                        value={draft.label}
                        onChange={(v) => patchFiche(item.entityTypeId, { label: v })}
                        placeholder={`Ex : ${item.typeName} — 12 rue des Lilas`}
                      />
                    </FormField>
                    {item.hasPlanning && (
                      <FormField
                        label="Date souhaitée"
                        help="Date du tournage / de l'intervention — l'équipe confirme à la validation."
                      >
                        <DateTimeField
                          value={draft.scheduledAt}
                          onChange={(v) => patchFiche(item.entityTypeId, { scheduledAt: v })}
                        />
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
                  help="Compte sur lequel les vidéos seront publiées."
                >
                  <Select
                    value={effectiveAccountId}
                    onChange={setAccountId}
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
