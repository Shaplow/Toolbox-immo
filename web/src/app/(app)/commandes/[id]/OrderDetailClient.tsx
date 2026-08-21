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
import { DateTimeField } from "@/components/ui/molecules/DateTimeField";
import { CustomFieldValueInput } from "@/components/fields/CustomFieldValueInput";
import { isoToLocalInput, shortDateTimeFr } from "@/lib/date/formatFr";
import { STATUS_LABELS } from "@/types/calendar";
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

  const editable = !isAdmin && (order.status === "SUBMITTED" || order.status === "REJECTED");

  // ─── Actions de cycle de vie ────────────────────────────────────────────
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

  async function saveFiche(entityId: string, hasPlanning: boolean) {
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
          label: draft.label,
          fields: draft.fields,
          ...(hasPlanning && draft.scheduledAt
            ? { scheduledAt: new Date(draft.scheduledAt).toISOString() }
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
        body: JSON.stringify({ scheduledAt: new Date(value).toISOString() }),
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
                    void runAction("/validate", undefined, "Commande validée — publications créées en banque.")
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
                    seuls les slots manquants sont recréés. */}
                {order.slots.length <
                  order.template.recipes.reduce((sum, r) => sum + r.count, 0) && (
                  <Button
                    size="sm"
                    onClick={() =>
                      void runAction("/validate", undefined, "Instanciation relancée.")
                    }
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
          </div>
        </div>
        {order.rejectedReason && order.status === "REJECTED" && (
          <p className="mt-3 text-[13px] text-danger-700 bg-danger-50 border border-danger-200 rounded-md px-3 py-2">
            Refusée : {order.rejectedReason}
            {!isAdmin && " — corrigez les fiches ci-dessous puis re-soumettez."}
          </p>
        )}
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
                  {entity.typeName} · {entity.label}
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
                  <FormField label="Libellé">
                    <Input value={draft.label} onChange={(v) => patchDraft(entity.id, { label: v })} />
                  </FormField>
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
                    />
                  ))}
                  {draft.dirty && (
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        onClick={() => void saveFiche(entity.id, entity.hasPlanning)}
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
        {order.slots.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            {order.status === "SUBMITTED"
              ? isAdmin
                ? "Les publications seront créées (en banque) à la validation de la commande."
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
                    ? (STATUS_LABELS[slot.status as keyof typeof STATUS_LABELS] ?? slot.status)
                    : slot.stepLabel}
                </span>
                {slot.scheduledAt ? (
                  <span className="text-[12px] text-muted-foreground">
                    {shortDateTimeFr(slot.scheduledAt)}
                  </span>
                ) : isAdminSlot(slot) ? (
                  <div className="flex items-center gap-1.5">
                    <DateTimeField
                      value={slotDates[slot.id] ?? ""}
                      onChange={(v) => setSlotDates((prev) => ({ ...prev, [slot.id]: v }))}
                    />
                    {slotDates[slot.id] && (
                      <Button size="sm" onClick={() => void saveSlotDate(slot.id)} disabled={busy}>
                        Placer
                      </Button>
                    )}
                  </div>
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
    </>
  );
}
