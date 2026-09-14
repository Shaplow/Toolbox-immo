"use client";

/**
 * Formulaire guidé de bon de commande :
 * 1. choix du modèle (composition affichée),
 * 2. une section par fiche à remplir (champs custom du type + date si planning),
 * 3. notes, puis soumission → /commandes/[id].
 *
 * Le compte Instagram ne se choisit PAS ici : il est posé au placement sur le
 * calendrier (cf. assignSlotAccount). Les publications naissent en banque, sans
 * compte.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Checkbox } from "@/components/ui/Checkbox";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Alert } from "@/components/ui/Alert";
import { Textarea } from "@/components/ui/Textarea";
import { toast } from "@/components/ui/Toast";
import { DateTimeField } from "@/components/ui/molecules/DateTimeField";
import { isPastLocalInput, localInputToIso } from "@/lib/date/formatFr";
import { CustomFieldValueInput } from "@/components/fields/CustomFieldValueInput";
import type { CustomField } from "@/lib/customFields";
import { renderLabelTemplate, resolveEntityLabel } from "@/lib/entityLabel";

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
    /** Modèle de libellé du type — non vide = plus de saisie de libellé. */
    labelTemplate: string | null;
  }[];
  /**
   * Lignes de vidéos du modèle — imposées ou au choix du demandeur.
   * `label` et `description` sont déjà les textes CLIENT : la page a résolu
   * `clientLabel ?? label` avant de les envoyer ici.
   */
  recipes: {
    patternTemplateId: string;
    label: string;
    description: string | null;
    count: number;
    isOptional: boolean;
    defaultSelected: boolean;
    minCount: number;
    /** null = vidéo proposée quel que soit le type de tournage. */
    shootTypeId: string | null;
  }[];
  /** Types de tournage proposés — vide = le modèle n'en a pas. */
  shootTypes: {
    id: string;
    label: string;
    description: string | null;
    videosDecidedLater: boolean;
  }[];
  videoSummary: string;
  videoCount: number;
}

interface NewOrderClientProps {
  templates: OrderTemplateOption[];
  clients: { id: string; name: string }[];
  isAdmin: boolean;
}

interface FicheDraft {
  label: string;
  fields: Record<string, string>;
  scheduledAt: string;
}

export function NewOrderClient({ templates, clients, isAdmin }: NewOrderClientProps) {
  const router = useRouter();
  const [templateId, setTemplateId] = useState<string>("");
  const [clientId, setClientId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [shootTypeId, setShootTypeId] = useState<string>("");
  const [fiches, setFiches] = useState<Record<string, FicheDraft>>({});
  const [submitting, setSubmitting] = useState(false);
  // Erreurs par champ : le formulaire est long, un toast seul oblige à
  // chercher lequel des ~12 champs est en cause.
  const [errors, setErrors] = useState<Record<string, string>>({});

  const template = templates.find((t) => t.id === templateId) ?? null;

  /**
   * Vidéos optionnelles retenues : `patternTemplateId → quantité`.
   *
   * Initialisé depuis `defaultSelected` / `count` du modèle à chaque changement
   * de modèle de commande — sinon une sélection faite sur un modèle resterait
   * collée au suivant.
   */
  const [recipeCounts, setRecipeCounts] = useState<Record<string, number>>({});

  const shootTypes = template?.shootTypes ?? [];
  const shootType = shootTypes.find((t) => t.id === shootTypeId) ?? null;

  /**
   * Les vidéos qui concernent le type retenu : celles qui lui sont rattachées,
   * plus les communes (`shootTypeId: null`). Tant qu'aucun type n'est choisi sur
   * un modèle qui en propose, on ne montre RIEN : afficher les communes seules
   * laisserait croire que c'est toute la commande.
   *
   * Le même filtre existe côté service — ce n'est pas une duplication
   * décorative : filtré ici seulement, cocher RVA1 ferait quand même naître les
   * vidéos des autres types à la validation.
   */
  const applicableRecipes =
    shootTypes.length > 0 && !shootTypeId
      ? []
      : (template?.recipes ?? []).filter(
          (r) => r.shootTypeId === null || r.shootTypeId === shootTypeId,
        );

  useEffect(() => {
    setRecipeCounts(
      Object.fromEntries(
        applicableRecipes
          .filter((r) => r.isOptional)
          .map((r) => [r.patternTemplateId, r.defaultSelected ? r.count : 0]),
      ),
    );
    // Volontairement sur (template, shootTypeId) : changer de type rejoue les
    // valeurs par défaut, sinon une quantité cochée sur RVA resterait collée
    // au passage sur RPOD.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, shootTypeId]);

  const optionalRecipes = applicableRecipes.filter((r) => r.isOptional);
  const requiredRecipes = applicableRecipes.filter((r) => !r.isOptional);


  function selectTemplate(id: string) {
    // Re-clic sur le modèle déjà sélectionné : ne pas purger les saisies.
    if (id === templateId) return;
    setTemplateId(id);
    // Le type appartient au modèle : le garder d'un modèle à l'autre pointerait
    // sur un type qui n'existe pas ici.
    setShootTypeId("");
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
   * Libellé effectif de la fiche primaire : calculé quand son type porte un
   * modèle, saisi sinon. Sert de référence aux fiches suivantes.
   *
   * Passe par le MÊME helper que `createOrder` (lib/entityLabel) au lieu de
   * réimplémenter le calcul : un miroir écrit à la main finit par diverger.
   */
  function primaryEffectiveLabel(): string {
    const primary = template?.items[0];
    if (!primary) return "";
    const draft = fiches[primary.entityTypeId];
    return primary.labelTemplate
      ? resolveEntityLabel(
          { name: primary.typeName, labelTemplate: primary.labelTemplate },
          draft?.fields ?? {},
        )
      : (draft?.label ?? "").trim();
  }

  /** Libellé des fiches secondaires sans modèle — dérivé de la première. */
  function derivedLabel(typeName: string): string {
    const primary = primaryEffectiveLabel();
    return primary ? `${typeName} — ${primary}` : "";
  }

  /** Libellé calculé d'une fiche à modèle, sans repli (vide tant que rien n'est saisi). */
  function autoLabel(item: OrderTemplateOption["items"][number]): string {
    return renderLabelTemplate(
      { name: item.typeName, labelTemplate: item.labelTemplate },
      fiches[item.entityTypeId]?.fields ?? {},
    );
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
    if (shootTypes.length > 0 && !shootTypeId) {
      found.shootType = "Choisissez un type de tournage.";
    }
    for (const [index, item] of template.items.entries()) {
      const draft = fiches[item.entityTypeId];
      // Les fiches suivantes tirent leur libellé de la première ; un type à
      // modèle ne demande aucune saisie.
      if (index === 0 && !item.labelTemplate && !draft?.label.trim()) {
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
          shootTypeId: shootTypeId || null,
          // Seulement les optionnelles : les imposées sont instanciées quoi
          // qu'il arrive, et le serveur refuse qu'on les lui envoie.
          recipes: optionalRecipes.map((r) => ({
            patternTemplateId: r.patternTemplateId,
            count: recipeCounts[r.patternTemplateId] ?? 0,
          })),
          notes: notes.trim() || null,
          clientId: isAdmin ? clientId : undefined,
          fiches: template.items.map((item, index) => {
            const draft = fiches[item.entityTypeId];
            return {
              entityTypeId: item.entityTypeId,
              // Un type à modèle : le serveur calcule, il reste seul
              // propriétaire de la valeur (dont la date du repli).
              // Sinon : saisi pour la première fiche, dérivé pour les suivantes.
              label: item.labelTemplate
                ? ""
                : index === 0
                  ? draft.label.trim()
                  : derivedLabel(item.typeName),
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

              {/* 1bis. Type de tournage — il commande quelles vidéos sont
                  proposées, donc il vient AVANT les fiches et les vidéos. */}
              {shootTypes.length > 0 && (
                <FormField
                  label="Type de tournage"
                  required
                  error={shootTypeId ? undefined : errors.shootType}
                  help={shootType?.description ?? "Il détermine les vidéos proposées."}
                >
                  <Select
                    value={shootTypeId}
                    onChange={(v) => {
                      setShootTypeId(v);
                      setErrors((prev) => {
                        const next = { ...prev };
                        delete next.shootType;
                        return next;
                      });
                    }}
                    options={shootTypes.map((t) => ({ value: t.id, label: t.label }))}
                    placeholder="Choisir un type…"
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
                    {item.labelTemplate ? (
                      /* Libellé calculé depuis les champs : rien à saisir. On
                         montre le rendu réel, pas le repli daté — l'afficher
                         avant toute saisie ressemblerait à un bug. */
                      <FormField label="Libellé" help="Calculé à partir de vos réponses.">
                        <p className="text-[13px] text-muted-foreground bg-muted/50 border border-border rounded-md px-3 py-2">
                          {autoLabel(item) || (
                            <span className="italic">
                              Renseignez les champs ci-dessous
                            </span>
                          )}
                        </p>
                      </FormField>
                    ) : idx === 0 ? (
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
                        validateNumberFormat
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

              {/* 3. Vidéos commandées — visible seulement si le modèle laisse
                     un choix, sinon c'est une section qui ne fait rien. */}
              {optionalRecipes.length > 0 && (
                <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                  <div>
                    <h3 className="text-[13px] font-semibold tracking-tight text-foreground">
                      Vidéos commandées
                    </h3>
                    <p className="text-[11.5px] text-muted-foreground">
                      Décochez ce dont vous n&apos;avez pas besoin. L&apos;équipe peut en
                      retirer ensuite si les rushs manquent.
                    </p>
                  </div>

                  {requiredRecipes.map((r) => (
                    <div
                      key={r.patternTemplateId}
                      className="flex items-start gap-2 text-[13px] text-foreground"
                    >
                      <Badge variant="default" size="sm">
                        Incluse
                      </Badge>
                      <div className="flex-1 min-w-0">
                        <span className="block truncate">{r.label}</span>
                        {r.description && (
                          <span className="block text-[11.5px] text-muted-foreground">
                            {r.description}
                          </span>
                        )}
                      </div>
                      <span className="text-[12px] tabular-nums text-muted-foreground">
                        ×{r.count}
                      </span>
                    </div>
                  ))}

                  {optionalRecipes.map((r) => {
                    const value = recipeCounts[r.patternTemplateId] ?? 0;
                    const checked = value > 0;
                    return (
                      <div key={r.patternTemplateId} className="flex items-start gap-2">
                        <Checkbox
                          checked={checked}
                          onChange={(next) =>
                            setRecipeCounts((prev) => ({
                              ...prev,
                              // Recocher repart du plancher s'il existe, sinon
                              // d'une vidéo : jamais de 0 « coché ».
                              [r.patternTemplateId]: next ? Math.max(1, r.minCount) : 0,
                            }))
                          }
                          size="sm"
                          label={r.label}
                        />
                        <div className="flex-1 min-w-0">
                          <span className="block truncate text-[13px] text-foreground">
                            {r.label}
                          </span>
                          {r.description && (
                            <span className="block text-[11.5px] text-muted-foreground">
                              {r.description}
                            </span>
                          )}
                        </div>
                        {checked && r.count > 1 && (
                          <div className="w-24 shrink-0">
                            <NumberStepper
                              value={value}
                              onChange={(v) =>
                                setRecipeCounts((prev) => ({
                                  ...prev,
                                  [r.patternTemplateId]: Math.max(
                                    Math.max(1, r.minCount),
                                    Math.min(r.count, Math.round(v)),
                                  ),
                                }))
                              }
                              min={Math.max(1, r.minCount)}
                              max={r.count}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Un type « nombre décidé plus tard » (RPOD) ne propose aucune
                  case. Sans un mot, le demandeur croirait que sa commande ne
                  produira rien — c'est exactement le silence qu'on chasse. */}
              {shootType?.videosDecidedLater && applicableRecipes.length === 0 && (
                <Alert variant="info">
                  Le nombre de vidéos sera décidé par l&apos;équipe après le tournage — il
                  dépend du contenu tourné. Rien à cocher ici.
                </Alert>
              )}

              {/* 4. Notes.
                  PAS de compte Instagram ici : il se choisit au placement sur
                  le calendrier, par l'admin — une même vidéo peut atterrir sur
                  plusieurs comptes, et le demandeur n'a pas à trancher. Le
                  champ s'affichait d'ailleurs dès que le client avait un compte,
                  indépendamment de la capacité « compte » des fiches, et se
                  présélectionnait tout seul quand il n'y en avait qu'un. */}
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
