"use client";

/**
 * Détail d'un bon de commande — role-aware.
 *
 * Admin : Valider (instancie les publications en banque, échecs `failed`
 * affichés) / Refuser (motif requis) / Clôturer / Annuler ; placement des
 * publications (date) sans quitter la page ; liens fiches + publications.
 * Externe : suivi simplifié (macro-étapes), édition des fiches tant que la
 * commande est SUBMITTED/REJECTED, re-soumission après refus, annulation.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { toast } from "@/components/ui/Toast";
import { renderLabelTemplate } from "@/lib/entityLabel";
import { DateTimeField } from "@/components/ui/molecules/DateTimeField";
import { CustomFieldValueInput } from "@/components/fields/CustomFieldValueInput";
import { isoToLocalInput, localInputToIso, shortDateTimeFr } from "@/lib/date/formatFr";
import type { SlotStatus } from "@/types/calendar";
import { slotBadgeLabel } from "@/lib/slots/statusLabels";
import {
  ENTITY_VALIDATION_BADGE,
  ENTITY_VALIDATION_LABELS,
  type EntityValidationStatus,
} from "@/types/entities";
import { ORDER_STATUS_BADGE, ORDER_STATUS_LABELS } from "@/types/orders";
import type { OrderDetail } from "@/lib/services/order/orderService";
import { EntityRushesPanel, type EntityRush } from "@/components/entities/EntityRushesPanel";

export interface OrderShootRushes {
  entityId: string;
  label: string;
  rushes: EntityRush[];
}

interface OrderDetailClientProps {
  order: OrderDetail;
  isAdmin: boolean;
  /** Rushs du tournage de la commande — admin uniquement. */
  shootRushes?: OrderShootRushes | null;
  currentUserId?: string;
}

/** Slot admin (id + statut technique présents) vs vue externe simplifiée. */
function isAdminSlot(
  slot: OrderDetail["slots"][number],
): slot is OrderDetail["slots"][number] & { id: string; status: string } {
  return "id" in slot;
}

const ROLE_LABELS: Record<"videaste" | "monteur" | "cm", string> = {
  videaste: "vidéaste",
  monteur: "monteur",
  cm: "CM",
};

export function OrderDetailClient({
  order,
  isAdmin,
  shootRushes = null,
  currentUserId = "",
}: OrderDetailClientProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  /**
   * Une publication déjà publiée bloque la suppression côté service — autant le
   * dire dans le dialogue plutôt que de laisser l'admin découvrir le refus
   * après avoir cliqué. `isAdminSlot` : la vue externe n'a pas de statut, mais
   * elle n'a pas non plus le bouton.
   */
  const publishedSlotCount = order.slots.filter(
    (slot) => isAdminSlot(slot) && slot.status === "PUBLISHED",
  ).length;

  const editable = !isAdmin && (order.status === "SUBMITTED" || order.status === "REJECTED");

  // ─── Actions de cycle de vie ────────────────────────────────────────────
  /**
   * Validation : le succès seul ne suffit pas. Un tournage resté sans vidéaste
   * n'apparaît dans la worklist de personne — l'admin doit le savoir tout de
   * suite, et le bandeau au-dessus le lui rappellera ensuite.
   *
   * MAIS : depuis que le compte se choisit au placement, une commande SANS
   * compte n'a par construction aucun assigné par défaut (ils vivent sur les
   * bindings, per-compte). Crier à l'anomalie à chaque validation apprendrait
   * en trois jours à ignorer l'alerte. On dit alors l'état normal et la suite à
   * donner, et on garde l'alerte pour le cas où elle veut encore dire quelque
   * chose : un compte est posé, et pourtant personne ne tourne.
   */
  async function runValidate(opts: { retry?: boolean } = {}) {
    const done = opts.retry ? "Instanciation relancée" : "Commande validée";
    setBusy(true);
    try {
      const res = await fetch(`/api/orders/${order.id}/validate`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        createdSlotIds?: string[];
        requested?: number;
        failed?: { label: string; error: string }[];
        unassignedShoots?: { id: string; label: string }[];
      };
      if (!res.ok) {
        toast.error(data.error ?? "Échec de la validation.");
        return;
      }
      if (data.failed?.length) {
        toast.error(
          `Publications non créées : ${data.failed.map((f) => `${f.label} (${f.error})`).join(" · ")}`,
        );
      }
      if (data.unassignedShoots?.length && order.account) {
        toast.error(
          `${done}, mais aucun vidéaste sur ${data.unassignedShoots
            .map((e) => `« ${e.label} »`)
            .join(", ")} — assignez-le depuis la fiche.`,
        );
      } else if (!data.failed?.length) {
        // Annoncer « publications créées » quand il n'y en a aucune est le
        // silence qu'on corrige : l'admin repartait en croyant sa commande
        // instanciée. Les trois cas se disent maintenant à voix haute.
        const created = data.createdSlotIds?.length ?? 0;
        if (created > 0) {
          const n = `${created} publication${created > 1 ? "s" : ""} créée${created > 1 ? "s" : ""}`;
          toast.success(
            order.account
              ? `${done} — ${n}, à placer depuis la banque du calendrier.`
              : `${done} — ${n} en banque, sans compte. Choisissez-le en les plaçant sur le calendrier : la recette et l'équipe suivront.`,
          );
        } else if (data.requested === 0) {
          // Zéro vidéo est NORMAL pour un type « nombre décidé plus tard »
          // (RPOD) : le crier comme une erreur de configuration ferait douter
          // d'une commande parfaitement valide.
          if (order.shootType?.videosDecidedLater) {
            toast.success(
              `${done} — les vidéos seront créées par l'équipe après le tournage.`,
            );
          } else {
            toast.error(
              `${done}, mais son modèle ne déclenche aucune vidéo — ajoutez une recette au modèle, puis réessayez l'instanciation.`,
            );
          }
        } else {
          toast.info(`${done} — les publications existaient déjà.`);
        }
      }
      router.refresh();
    } catch {
      toast.error("Erreur réseau.");
    } finally {
      setBusy(false);
    }
  }

  async function runAction(
    path: string,
    body?: Record<string, unknown>,
    successMessage?: string,
  ) {
    setBusy(true);
    try {
      const res = await fetch(`/api/orders/${order.id}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        failed?: { label: string; error: string }[];
      };
      if (!res.ok) {
        toast.error(data.error ?? "Échec de l'action.");
        return false;
      }
      if (data.failed && data.failed.length > 0) {
        toast.error(
          `Publications non créées : ${data.failed.map((f) => `${f.label} (${f.error})`).join(" · ")}`,
        );
      }
      if (successMessage) toast.success(successMessage);
      router.refresh();
      return true;
    } catch {
      toast.error("Erreur réseau.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  /**
   * Suppression définitive. Pas `runAction` : c'est un DELETE, et surtout la
   * commande n'existe plus après — rafraîchir la page mènerait à un 404. On
   * retourne à la liste.
   */
  async function runDelete() {
    setBusy(true);
    try {
      const res = await fetch(`/api/orders/${order.id}`, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        slotsDeleted?: number;
        entitiesKept?: number;
      };
      if (!res.ok) {
        toast.error(data.error ?? "Échec de la suppression.");
        return;
      }
      const parts = [`${data.slotsDeleted ?? 0} publication(s) supprimée(s)`];
      if (data.entitiesKept) parts.push(`${data.entitiesKept} fiche(s) conservée(s)`);
      toast.success(`Commande supprimée — ${parts.join(", ")}.`);
      router.push("/commandes");
    } catch {
      toast.error("Erreur réseau.");
    } finally {
      setBusy(false);
    }
  }

  // ─── Édition de fiche (externe) ─────────────────────────────────────────
  const [ficheDrafts, setFicheDrafts] = useState<
    Record<string, { label: string; fields: Record<string, string>; scheduledAt: string; dirty: boolean }>
  >(() =>
    Object.fromEntries(
      order.entities.map((e) => [
        e.id,
        {
          label: e.label,
          fields: e.fields,
          scheduledAt: e.scheduledAt ? isoToLocalInput(e.scheduledAt) : "",
          dirty: false,
        },
      ]),
    ),
  );

  function patchDraft(
    entityId: string,
    patch: Partial<{ label: string; fields: Record<string, string>; scheduledAt: string }>,
  ) {
    setFicheDrafts((prev) => ({
      ...prev,
      [entityId]: { ...prev[entityId], ...patch, dirty: true },
    }));
  }

  async function saveFiche(entityId: string, hasPlanning: boolean, hasLabelTemplate = false) {
    const draft = ficheDrafts[entityId];
    if (!draft) return;
    if (hasPlanning && !draft.scheduledAt) {
      // Le serveur refuse une fiche à planning sans date — sans ce guard le
      // PATCH omettrait la date et afficherait un faux succès.
      toast.error("Une date est requise pour cette fiche.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/orders/${order.id}/entities/${entityId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Un type à modèle calcule son libellé : le renvoyer ici le
          // marquerait « personnalisé » dès le premier enregistrement.
          ...(hasLabelTemplate ? {} : { label: draft.label }),
          fields: draft.fields,
          ...(hasPlanning && draft.scheduledAt
            ? { scheduledAt: localInputToIso(draft.scheduledAt) }
            : {}),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? "Échec de l'enregistrement.");
        return;
      }
      toast.success("Fiche enregistrée.");
      setFicheDrafts((prev) => ({ ...prev, [entityId]: { ...prev[entityId], dirty: false } }));
      router.refresh();
    } catch {
      toast.error("Erreur réseau.");
    } finally {
      setBusy(false);
    }
  }

  // ─── Validation client d'une fiche (PENDING_CLIENT, externe) ───────────
  async function validateFiche(entityId: string, action: "approve" | "reject") {
    setBusy(true);
    try {
      const res = await fetch(`/api/entities/${entityId}/validation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? "Échec de la validation.");
        return;
      }
      toast.success(action === "approve" ? "Fiche validée." : "Fiche refusée.");
      router.refresh();
    } catch {
      toast.error("Erreur réseau.");
    } finally {
      setBusy(false);
    }
  }

  // ─── Placement d'une publication (admin) ────────────────────────────────
  const [slotDates, setSlotDates] = useState<Record<string, string>>({});
  async function saveSlotDate(slotId: string) {
    const value = slotDates[slotId];
    if (!value) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/calendar/slots/${slotId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduledAt: localInputToIso(value) }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? "Échec du placement.");
        return;
      }
      toast.success("Publication placée sur le calendrier.");
      setSlotDates((prev) => {
        const next = { ...prev };
        delete next[slotId];
        return next;
      });
      router.refresh();
    } catch {
      toast.error("Erreur réseau.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* Header */}
      <div className="mb-6">
        <Breadcrumb
          className="mb-2"
          items={[
            { href: "/commandes", label: isAdmin ? "Commandes" : "Mes commandes" },
            { label: order.template.name },
          ]}
        />
        <div className="flex items-start gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold text-foreground leading-tight">
              {order.template.name}
            </h1>
            <div className="mt-1.5 flex items-center gap-3 flex-wrap text-[12.5px] text-muted-foreground">
              {isAdmin && <span>{order.client.name}</span>}
              {/* Le type de tournage retenu : c'est lui qui explique quelles
                  vidéos ont été proposées, et pourquoi il n'y en a parfois
                  aucune. */}
              {order.shootType && <span>{order.shootType.label}</span>}
              {order.account && <span>@{order.account.handle}</span>}
              <span>Créée le {shortDateTimeFr(order.createdAt)}</span>
              {order.validatedAt && <span>Validée le {shortDateTimeFr(order.validatedAt)}</span>}
            </div>
          </div>
          <div className="ml-auto shrink-0 flex items-center gap-2">
            <span
              className={["text-[11px] rounded-md px-2 py-1 border", ORDER_STATUS_BADGE[order.status]].join(" ")}
            >
              {ORDER_STATUS_LABELS[order.status]}
            </span>
            {isAdmin && order.status === "SUBMITTED" && (
              <>
                <Button
                  size="sm"
                  onClick={() =>
                    void runValidate()
                  }
                  disabled={busy}
                >
                  Valider
                </Button>
                <Button size="sm" variant="outline" onClick={() => setRejectOpen(true)} disabled={busy}>
                  Refuser
                </Button>
              </>
            )}
            {isAdmin && order.status === "VALIDATED" && (
              <>
                {/* Instanciation partielle (failed[]) : /validate est idempotent,
                    seuls les slots manquants sont recréés. Passe par runValidate
                    et non runAction : le retry a besoin du même diagnostic que
                    la validation (0 créée ≠ succès). */}
                {/* `effectiveCount` et non `count` : une vidéo optionnelle
                    décochée par le demandeur n'a jamais été demandée, sinon le
                    bouton resterait allumé en permanence. Une vidéo ANNULÉE
                    reste comptée dans order.slots — c'est ce qui empêche de la
                    recréer (cf. cancelSlot). */}
                {order.slots.length <
                  order.template.recipes.reduce((sum, r) => sum + r.effectiveCount, 0) && (
                  <Button
                    size="sm"
                    onClick={() => void runValidate({ retry: true })}
                    disabled={busy}
                  >
                    Réessayer l&apos;instanciation
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void runAction("/done", undefined, "Commande clôturée.")}
                  disabled={busy}
                >
                  Clôturer
                </Button>
              </>
            )}
            {!isAdmin && order.status === "REJECTED" && (
              <Button
                size="sm"
                onClick={() => void runAction("/resubmit", undefined, "Commande re-soumise.")}
                disabled={busy}
              >
                Re-soumettre
              </Button>
            )}
            {(isAdmin
              ? order.status !== "CANCELLED" && order.status !== "DONE"
              : order.status === "SUBMITTED") && (
              <Button size="sm" variant="ghost" onClick={() => setCancelOpen(true)} disabled={busy}>
                Annuler
              </Button>
            )}
            {isAdmin && (
              <Button size="sm" variant="ghost" onClick={() => setDeleteOpen(true)} disabled={busy}>
                Supprimer
              </Button>
            )}
          </div>
        </div>
        {order.rejectedReason && order.status === "REJECTED" && (
          <p className="mt-3 text-[13px] text-danger-700 bg-danger-50 border border-danger-200 rounded-md px-3 py-2">
            Refusée : {order.rejectedReason}
            {!isAdmin && " — corrigez les fiches ci-dessous puis re-soumettez."}
          </p>
        )}
        {/* Deux recettes de la commande désignent des personnes différentes
            pour un même rôle : la première l'emporte, silencieusement. On le
            dit — persistant, car le choix reste vrai après la validation. */}
        {isAdmin &&
          order.assigneeConflicts?.map((c) => (
            <p
              key={`conflict-${c.role}-${c.keptRecipeLabel}`}
              className="mt-3 text-[13px] text-warning-700 bg-warning-50 border border-warning-200 rounded-md px-3 py-2"
            >
              Recettes en désaccord sur le {ROLE_LABELS[c.role]} : « {c.keptRecipeLabel} » désigne{" "}
              {c.keptName} (appliqué),{" "}
              {c.ignored.map((i) => `« ${i.recipeLabel} » désigne ${i.name}`).join(", ")}.
            </p>
          ))}
        {/* Un tournage sans vidéaste n'apparaît dans la worklist de personne.
            Persistant (pas un toast) et cliquable jusqu'à l'assignation. */}
        {isAdmin &&
          order.entities.filter((e) => e.missingVideaste).map((e) => (
            <p
              key={`novideaste-${e.id}`}
              className="mt-3 text-[13px] text-warning-700 bg-warning-50 border border-warning-200 rounded-md px-3 py-2"
            >
              Aucun vidéaste sur « {e.label} » — personne ne verra ce tournage.{" "}
              <Link href={`/fiches/${e.id}`} className="underline font-medium">
                Assigner un vidéaste
              </Link>
            </p>
          ))}
        {/* Tournage refusé par le vidéaste. Visible aussi par le demandeur :
            sa commande restait « Validée » pendant que son tournage était
            décliné, et le refus ne vivait que dans l'inbox admin. */}
        {order.entities
          .filter((e) => e.videasteDeclined)
          .map((e) => (
            <p
              key={`declined-${e.id}`}
              className="mt-3 text-[13px] text-danger-700 bg-danger-50 border border-danger-200 rounded-md px-3 py-2"
            >
              Le vidéaste s&apos;est déclaré indisponible pour « {e.label} ».{" "}
              {isAdmin ? (
                <Link href={`/fiches/${e.id}`} className="underline font-medium">
                  Réassigner ou relancer
                </Link>
              ) : (
                <span className="text-danger-700/80">
                  L&apos;équipe replanifie le tournage.
                </span>
              )}
            </p>
          ))}
        {order.notes && (
          <p className="mt-3 text-[13px] text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
            {order.notes}
          </p>
        )}
      </div>

      {/* Fiches */}
      <div className="space-y-4 mb-8">
        <h2 className="text-[13px] font-semibold text-foreground uppercase tracking-wide">
          Fiches
        </h2>
        {order.entities.map((entity) => {
          const draft = ficheDrafts[entity.id];
          const validation = entity.validationStatus as EntityValidationStatus | null;
          return (
            <div key={entity.id} className="bg-card border border-border rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-[13px] font-semibold text-foreground flex-1 min-w-0">
                  {entity.label.startsWith(entity.typeName)
                    ? entity.label
                    : `${entity.typeName} · ${entity.label}`}
                </p>
                {validation && (
                  <span
                    className={["text-[10px] rounded px-1.5 py-0.5 border", ENTITY_VALIDATION_BADGE[validation]].join(" ")}
                  >
                    {ENTITY_VALIDATION_LABELS[validation]}
                  </span>
                )}
                {!isAdmin && validation === "PENDING_CLIENT" && (
                  <>
                    <Button size="sm" onClick={() => void validateFiche(entity.id, "approve")} disabled={busy}>
                      Valider
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void validateFiche(entity.id, "reject")} disabled={busy}>
                      Refuser
                    </Button>
                  </>
                )}
                {isAdmin && (
                  <Link
                    href={`/fiches/${entity.id}`}
                    className="text-[12px] text-primary hover:underline inline-flex items-center gap-1"
                  >
                    Ouvrir la fiche <ExternalLink size={11} />
                  </Link>
                )}
              </div>

              {editable && draft ? (
                <div className="space-y-3">
                  {entity.labelTemplate ? (
                    <FormField label="Libellé" help="Calculé à partir des champs.">
                      <p className="text-[13px] text-muted-foreground bg-muted/50 border border-border rounded-md px-3 py-2">
                        {renderLabelTemplate(
                          { name: entity.typeName, labelTemplate: entity.labelTemplate },
                          draft.fields,
                        ) || <span className="italic">Renseignez les champs</span>}
                      </p>
                    </FormField>
                  ) : (
                    <FormField label="Libellé">
                      <Input value={draft.label} onChange={(v) => patchDraft(entity.id, { label: v })} />
                    </FormField>
                  )}
                  {entity.hasPlanning && (
                    <FormField label="Date souhaitée">
                      <DateTimeField
                        value={draft.scheduledAt}
                        onChange={(v) => patchDraft(entity.id, { scheduledAt: v })}
                      />
                    </FormField>
                  )}
                  {entity.fieldSchema.map((field) => (
                    <CustomFieldValueInput
                      key={field.key}
                      field={field}
                      value={draft.fields[field.key] ?? ""}
                      onChange={(v) =>
                        patchDraft(entity.id, { fields: { ...draft.fields, [field.key]: v } })
                      }
                      showLabel
                      validateNumberFormat
                      previousValue={entity.fields[field.key] ?? ""}
                    />
                  ))}
                  {draft.dirty && (
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        onClick={() =>
                          void saveFiche(entity.id, entity.hasPlanning, !!entity.labelTemplate)
                        }
                        disabled={busy}
                      >
                        Enregistrer
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                  {entity.scheduledAt && (
                    <div className="text-[12.5px]">
                      <dt className="text-muted-foreground inline">Date : </dt>
                      <dd className="text-foreground inline">{shortDateTimeFr(entity.scheduledAt)}</dd>
                    </div>
                  )}
                  {entity.fieldSchema.map((field) => (
                    <div key={field.key} className="text-[12.5px]">
                      <dt className="text-muted-foreground inline">{field.label} : </dt>
                      <dd className="text-foreground inline">
                        {entity.fields[field.key]?.trim() || "—"}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          );
        })}
      </div>

      {/* Rushs du tournage (admin) */}
      {isAdmin && shootRushes && (
        <div className="mb-8">
          <EntityRushesPanel
            entityId={shootRushes.entityId}
            rushes={shootRushes.rushes}
            canUpload
            canManage
            currentUserId={currentUserId}
            title={`Rushs · ${shootRushes.label}`}
          />
        </div>
      )}

      {/* Publications */}
      <div className="space-y-3">
        <h2 className="text-[13px] font-semibold text-foreground uppercase tracking-wide">
          Publications
        </h2>
        {/* Demandées vs créées, par recette. Sans ce récap, « 4 publications »
            ne dit pas si l'une manque ou si le demandeur en avait décoché une —
            et c'est précisément la question qu'on se pose trois semaines plus
            tard. Une vidéo annulée reste comptée comme créée : elle l'a été. */}
        {isAdmin && order.template.recipes.some((r) => r.effectiveCount > 0) && (
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-muted-foreground">
            {order.template.recipes.map((r) => {
              const created = order.slots.filter((slot) =>
                (slot.label ?? "").startsWith(r.label),
              ).length;
              return (
                <li key={r.patternTemplateId} className="tabular-nums">
                  <span className="text-foreground">{r.label}</span> · {created}/
                  {r.effectiveCount} créée{r.effectiveCount > 1 ? "s" : ""}
                  {r.isOptional && r.effectiveCount < r.count && (
                    <span className="text-muted-foreground"> (choix du demandeur)</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {order.slots.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            {order.status === "SUBMITTED"
              ? isAdmin
                ? "Les publications seront créées à la validation de la commande, sans date — à placer ensuite sur le calendrier."
                : "Les vidéos seront lancées quand l'équipe aura validé la commande."
              : "Aucune publication liée."}
          </p>
        ) : (
          <ul className="space-y-2">
            {order.slots.map((slot, i) => (
              <li
                key={isAdminSlot(slot) ? slot.id : i}
                className="bg-card border border-border rounded-lg px-4 py-3 flex items-center gap-3 flex-wrap"
              >
                <span className="text-[13px] text-foreground flex-1 min-w-0 truncate">
                  {slot.label ?? "Publication"}
                </span>
                <span className="text-[10px] rounded px-1.5 py-0.5 border border-border bg-muted text-muted-foreground">
                  {isAdminSlot(slot)
                    ? slotBadgeLabel(slot.status as SlotStatus, slot.scheduledAt)
                    : slot.stepLabel}
                </span>
                {isAdminSlot(slot) ? (
                  <div className="flex items-center gap-1.5">
                    <DateTimeField
                      // Pré-rempli avec la date en place : le placement n'était
                      // possible qu'une fois, il fallait sortir de la commande
                      // pour corriger une date posée par erreur.
                      value={
                        slotDates[slot.id] ??
                        (slot.scheduledAt ? isoToLocalInput(slot.scheduledAt) : "")
                      }
                      onChange={(v) => setSlotDates((prev) => ({ ...prev, [slot.id]: v }))}
                      // Heure de publication de la recette plutôt qu'un 09:00
                      // générique qu'il fallait corriger à chaque placement.
                      defaultTime={slot.defaultTime ?? undefined}
                    />
                    {slotDates[slot.id] && (
                      <Button size="sm" onClick={() => void saveSlotDate(slot.id)} disabled={busy}>
                        {slot.scheduledAt ? "Replacer" : "Placer"}
                      </Button>
                    )}
                  </div>
                ) : slot.scheduledAt ? (
                  <span className="text-[12px] text-muted-foreground">
                    {shortDateTimeFr(slot.scheduledAt)}
                  </span>
                ) : (
                  <span className="text-[12px] text-muted-foreground italic">À planifier</span>
                )}
                {isAdminSlot(slot) && (
                  <Link
                    href={`/publications/${slot.id}`}
                    className="text-[12px] text-primary hover:underline inline-flex items-center gap-1"
                  >
                    Ouvrir <ExternalLink size={11} />
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Dialogs */}
      <ConfirmDialog
        open={rejectOpen}
        title="Refuser la commande ?"
        description="Le motif est transmis à l'agence — elle pourra corriger ses fiches puis re-soumettre."
        confirmLabel="Refuser"
        variant="danger"
        loading={busy}
        onConfirm={async () => {
          if (!rejectReason.trim()) {
            toast.error("Un motif est requis.");
            return;
          }
          const ok = await runAction("/reject", { reason: rejectReason }, "Commande refusée.");
          if (ok) {
            setRejectOpen(false);
            setRejectReason("");
          }
        }}
        onCancel={() => setRejectOpen(false)}
      >
        <textarea
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          rows={3}
          placeholder="Motif du refus (visible par l'agence)…"
          className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={cancelOpen}
        title="Annuler la commande ?"
        description={
          isAdmin
            ? "Refusé si des publications actives y sont liées."
            : "La commande sera annulée — cette action est définitive."
        }
        confirmLabel="Annuler la commande"
        variant="danger"
        loading={busy}
        onConfirm={async () => {
          const ok = await runAction("/cancel", undefined, "Commande annulée.");
          if (ok) setCancelOpen(false);
        }}
        onCancel={() => setCancelOpen(false)}
      />

      {/* Chiffrer l'impact AVANT le clic : « supprimer une commande » ne dit pas
          de lui-même que des publications partent avec, ni que les fiches
          restent. */}
      <ConfirmDialog
        open={deleteOpen}
        title="Supprimer définitivement cette commande ?"
        description={
          publishedSlotCount > 0
            ? `${publishedSlotCount} publication(s) de cette commande sont déjà publiées : la suppression sera refusée. Annulez la commande plutôt.`
            : [
                order.slots.length > 0
                  ? `${order.slots.length} publication(s) seront supprimées.`
                  : "Cette commande n'a créé aucune publication.",
                order.entities.length > 0
                  ? `${order.entities.length} fiche(s) seront conservées, simplement détachées.`
                  : null,
                "Cette action est définitive.",
              ]
                .filter(Boolean)
                .join(" ")
        }
        confirmLabel="Supprimer la commande"
        variant="danger"
        loading={busy}
        onConfirm={async () => {
          await runDelete();
          setDeleteOpen(false);
        }}
        onCancel={() => setDeleteOpen(false)}
      />
    </>
  );
}
