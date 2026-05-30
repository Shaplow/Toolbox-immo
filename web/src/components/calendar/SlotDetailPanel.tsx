"use client";

/**
 * SlotDetailPanel — drawer édition slot rapide (Phase 6 refonte MID).
 *
 * Drawer Liquid Glass v2 côté droit, avec 4 onglets pour répartir les
 * champs lourds :
 * - Statut       : transition status + notes (visible pour tous les rôles)
 * - Assignations : vidéaste / monteur / CM (ADMIN only)
 * - Overrides    : per-slot needs* + presets (ADMIN only)
 * - Planning     : date + heure (ADMIN only)
 *
 * Pour MONTEUR/CM/VIDEASTE le drawer expose uniquement le tab Statut.
 *
 * Raccourcis (Phase 7) :
 * - ⌘O / Enter : ouvre la fiche complète /publications/[id]
 * - ESC        : ferme (géré par Drawer)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Ban,
  ExternalLink,
  Trash2,
  Save,
  ListChecks,
  Users,
  SlidersHorizontal,
  CalendarClock,
  Clapperboard,
} from "lucide-react";
import {
  STATUS_LABELS,
  type SlotStatus,
  type PublicationSlot,
} from "@/types/calendar";
import { STATUS_TRANSITIONS } from "@/lib/services/slot/transitions";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Drawer } from "@/components/ui/Drawer";
import { Tabs } from "@/components/ui/Tabs";
import { Button } from "@/components/ui/Button";
import { FormField } from "@/components/ui/FormField";
import { Textarea } from "@/components/ui/Textarea";
import { Combobox } from "@/components/ui/Combobox";
import { DatePicker } from "@/components/ui/DatePicker";
import { TimePicker } from "@/components/ui/TimePicker";
import { AssigneePicker } from "@/components/ui/molecules/AssigneePicker";
import { OverrideControl } from "@/components/ui/molecules/OverrideControl";
import { toast } from "@/components/ui/Toast";

export type SlotDetailPanelMode = "admin" | "monteur" | "cm";

interface SlotDetailPanelProps {
  slot: PublicationSlot;
  onUpdated: (slot: PublicationSlot) => void;
  onDeleted: (id: string) => void;
  onClose: () => void;
  mode?: SlotDetailPanelMode;
}

const STATUSES = Object.keys(STATUS_LABELS) as SlotStatus[];

const RESERVED_TERMINAL_FOR_SELECT = new Set<SlotStatus>([
  "PUBLISHED",
  "CANCELLED",
  "ARCHIVED",
  "REJECTED",
]);

type TabKey = "status" | "assignees" | "overrides" | "planning";

interface UserOpt {
  id: string;
  name: string | null;
  role: string;
  email?: string | null;
}

// Phase mapping description override
const DESCRIPTION_OPTIONS = [
  { value: "none", label: "Aucune" },
  { value: "preFilled", label: "Pré-remplie" },
  { value: "autoGenerate", label: "Auto-générée" },
  { value: "manualWrite", label: "Manuelle" },
];

const COVER_MODE_OPTIONS = [
  { value: "none", label: "Pas de cover" },
  { value: "manualSelect", label: "Sélection libre (CM)" },
  { value: "autoPack", label: "Pack auto → sélection (CM)" },
  { value: "monteurUpload", label: "Upload par le monteur" },
];

export function SlotDetailPanel({
  slot,
  onUpdated,
  onDeleted,
  onClose,
  mode = "admin",
}: SlotDetailPanelProps) {
  const isRestricted = mode !== "admin";
  const router = useRouter();

  const [tab, setTab] = useState<TabKey>("status");

  // ─── Form state ─────────────────────────────────────────────────────────
  const [notes, setNotes] = useState(slot.notes ?? "");
  const [status, setStatus] = useState<SlotStatus>(slot.status);
  const [assigneeMonteurId, setAssigneeMonteurId] = useState<string>(slot.assigneeMonteurId ?? "");
  const [assigneeCmId, setAssigneeCmId] = useState<string>(slot.assigneeCmId ?? "");
  const [assigneeVideasteId, setAssigneeVideasteId] = useState<string>(slot.assigneeVideasteId ?? "");
  const [needsAdminValidationOverride, setNeedsAdminValidationOverride] = useState<boolean | null>(
    slot.needsAdminValidationOverride ?? null,
  );
  const [needsCaptionsOverride, setNeedsCaptionsOverride] = useState<boolean | null>(
    slot.needsCaptionsOverride ?? null,
  );
  const [needsDescriptionOverride, setNeedsDescriptionOverride] = useState<string | null>(
    slot.needsDescriptionOverride ?? null,
  );
  const [needsRushesOverride, setNeedsRushesOverride] = useState<boolean | null>(
    slot.needsRushesOverride ?? null,
  );
  const [needsBriefOverride, setNeedsBriefOverride] = useState<boolean | null>(
    slot.needsBriefOverride ?? null,
  );
  const [coverModeOverride, setCoverModeOverride] = useState<string | null>(
    slot.coverModeOverride ?? null,
  );
  const [captionPresetIdOverride, setCaptionPresetIdOverride] = useState<string | null>(
    slot.captionPresetIdOverride ?? null,
  );
  const [descriptionPromptIdOverride, setDescriptionPromptIdOverride] = useState<string | null>(
    slot.descriptionPromptIdOverride ?? null,
  );

  // ─── Planning (admin only) ──────────────────────────────────────────────
  const scheduledDate = useMemo(() => new Date(slot.scheduledAt), [slot.scheduledAt]);
  const initialDateStr = useMemo(
    () => scheduledDate.toISOString().slice(0, 10),
    [scheduledDate],
  );
  const initialTimeStr = useMemo(() => {
    const hh = String(scheduledDate.getHours()).padStart(2, "0");
    const mm = String(scheduledDate.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }, [scheduledDate]);
  const [planDate, setPlanDate] = useState<string>(initialDateStr);
  const [planTime, setPlanTime] = useState<string>(initialTimeStr);

  const [users, setUsers] = useState<UserOpt[]>([]);
  const [captionPresets, setCaptionPresets] = useState<Array<{ id: string; name: string }>>([]);
  const [descriptionPrompts, setDescriptionPrompts] = useState<Array<{ id: string; name: string }>>([]);

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ─── Effects ────────────────────────────────────────────────────────────
  // Fetch presets / prompts admin uniquement.
  useEffect(() => {
    if (isRestricted) return;
    let cancelled = false;
    void (async () => {
      try {
        const [capRes, prmRes] = await Promise.all([
          fetch("/api/caption-presets"),
          fetch("/api/description/prompts"),
        ]);
        if (cancelled) return;
        if (capRes.ok) {
          setCaptionPresets(
            (await capRes.json()) as Array<{ id: string; name: string }>,
          );
        }
        if (prmRes.ok) {
          const prompts = (await prmRes.json()) as Array<{
            id: string;
            name: string;
            isActive: boolean;
          }>;
          setDescriptionPrompts(prompts.filter((p) => p.isActive));
        }
      } catch {
        // silencieux
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isRestricted]);

  // Fetch users (admin only).
  useEffect(() => {
    if (isRestricted) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/admin/users");
        if (!res.ok) return;
        const data = (await res.json()) as Array<{
          id: string;
          name: string | null;
          role: string;
          email?: string | null;
        }>;
        if (cancelled) return;
        setUsers(data);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isRestricted]);

  // ⌘O / Enter pour ouvrir la fiche complète (Phase 7).
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      // Ignore si focus dans un champ texte / combobox / dialog (le ConfirmDialog).
      if (
        target &&
        (target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement ||
          target.isContentEditable ||
          target.closest("[role=combobox], [role=textbox]"))
      ) {
        return;
      }
      // ⌘O ouvre la fiche complète (sans condition de focus si modifier).
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        router.push(`/publications/${slot.id}`);
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [slot.id, router]);

  // ─── Available statuses ─────────────────────────────────────────────────
  const availableStatuses: SlotStatus[] = useMemo(() => {
    const transitions = STATUS_TRANSITIONS as Record<string, SlotStatus[]>;
    const allowed = transitions[slot.status] ?? [];
    const set = new Set<SlotStatus>([slot.status as SlotStatus, ...allowed]);
    return STATUSES.filter((s) => set.has(s) && !RESERVED_TERMINAL_FOR_SELECT.has(s));
  }, [slot.status]);

  const statusOptions = useMemo(
    () =>
      (isRestricted ? availableStatuses : STATUSES).map((s) => ({
        value: s,
        label: STATUS_LABELS[s],
      })),
    [availableStatuses, isRestricted],
  );

  // ─── Filtered user lists per role ──────────────────────────────────────
  const monteurUsers = useMemo(
    () => users.filter((u) => u.role === "MONTEUR" || u.role === "ADMIN"),
    [users],
  );
  const cmUsers = useMemo(
    () => users.filter((u) => u.role === "CM" || u.role === "ADMIN"),
    [users],
  );
  const videasteUsers = useMemo(
    () => users.filter((u) => u.role === "VIDEASTE" || u.role === "ADMIN"),
    [users],
  );

  // ─── Save / Cancel / Delete ────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      let body: Record<string, unknown>;
      if (isRestricted) {
        body = { status, notes: notes || null };
      } else {
        // Recompose scheduledAt depuis date + heure (admin only).
        const scheduledAtIso = (() => {
          if (!planDate || !planTime) return undefined;
          const [hh, mm] = planTime.split(":");
          const d = new Date(`${planDate}T00:00:00`);
          d.setHours(Number(hh) || 0, Number(mm) || 0, 0, 0);
          return d.toISOString();
        })();

        body = {
          status,
          notes: notes || null,
          assigneeMonteurId: assigneeMonteurId || null,
          assigneeCmId: assigneeCmId || null,
          assigneeVideasteId: assigneeVideasteId || null,
          scheduledAt: scheduledAtIso,
          needsAdminValidationOverride,
          needsCaptionsOverride,
          needsDescriptionOverride,
          needsRushesOverride,
          needsBriefOverride,
          coverModeOverride,
          captionPresetIdOverride,
          descriptionPromptIdOverride,
        };
      }

      const res = await fetch(`/api/calendar/slots/${slot.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      // Parse safe — endpoint peut renvoyer du HTML en cas de crash backend.
      let parsed: unknown = null;
      const rawText = await res.text();
      if (rawText) {
        try {
          parsed = JSON.parse(rawText);
        } catch {
          throw new Error(`Réponse serveur inattendue (status ${res.status}).`);
        }
      }
      if (!res.ok) {
        const errMsg =
          (parsed as { error?: string } | null)?.error ?? `Erreur ${res.status}`;
        throw new Error(errMsg);
      }
      onUpdated(parsed as PublicationSlot);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setSaving(false);
    }
  }, [
    isRestricted,
    status,
    notes,
    assigneeMonteurId,
    assigneeCmId,
    assigneeVideasteId,
    needsAdminValidationOverride,
    needsCaptionsOverride,
    needsDescriptionOverride,
    needsRushesOverride,
    needsBriefOverride,
    coverModeOverride,
    captionPresetIdOverride,
    descriptionPromptIdOverride,
    planDate,
    planTime,
    slot.id,
    onUpdated,
  ]);

  async function handleCancelConfirmed() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/calendar/slots/${slot.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "CANCELLED" }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({ error: `Erreur ${res.status}` }))) as {
          error?: string;
        };
        throw new Error(d.error ?? `Erreur ${res.status}`);
      }
      const updated = (await res.json()) as PublicationSlot;
      onUpdated(updated);
      setConfirmCancel(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteConfirmed() {
    setDeleting(true);
    setConfirmDeleteOpen(false);
    try {
      const res = await fetch(`/api/calendar/slots/${slot.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Erreur lors de la suppression");
      onDeleted(slot.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur inconnue";
      setError(msg);
      toast.error(msg);
    } finally {
      setDeleting(false);
    }
  }

  // ─── Tabs configuration ────────────────────────────────────────────────
  const tabItems = isRestricted
    ? [{ id: "status", label: "Statut", icon: ListChecks }]
    : [
        { id: "status", label: "Statut", icon: ListChecks },
        { id: "assignees", label: "Équipe", icon: Users },
        { id: "overrides", label: "Overrides", icon: SlidersHorizontal },
        { id: "planning", label: "Planning", icon: CalendarClock },
      ];

  const dateLabel = scheduledDate.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const timeLabel = scheduledDate.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const title = slot.pattern?.label ?? slot.title ?? "Publication";

  return (
    <>
      <ConfirmDialog
        open={confirmCancel}
        title="Annuler cette mission ?"
        description="Le slot passera au statut « Annulé ». Aucune donnée n'est supprimée — l'historique reste consultable."
        confirmLabel="Annuler la mission"
        variant="danger"
        loading={saving}
        onConfirm={() => {
          void handleCancelConfirmed();
        }}
        onCancel={() => setConfirmCancel(false)}
      />

      <ConfirmDialog
        open={confirmDeleteOpen}
        title="Supprimer ce slot ?"
        description="Cette action est irréversible. Le slot et toutes ses données associées seront supprimés."
        confirmLabel="Supprimer"
        variant="danger"
        loading={deleting}
        onConfirm={() => {
          void handleDeleteConfirmed();
        }}
        onCancel={() => setConfirmDeleteOpen(false)}
      />

      <Drawer open onClose={onClose} side="right" size="lg">
        {/* Header drawer custom — eyebrow + title + meta + actions */}
        <header className="shrink-0 px-5 pt-5 pb-3 border-b border-white/30">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500">
                Édition rapide
              </p>
              <h2 className="mt-1 text-[18px] font-semibold tracking-tight text-gray-950 truncate leading-tight">
                {title}
              </h2>
              <p className="mt-1.5 text-[11px] text-gray-500">
                {dateLabel} · {timeLabel} · @{slot.account.handle}
              </p>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="secondary"
                size="sm"
                icon={ExternalLink}
                onClick={() => router.push(`/publications/${slot.id}`)}
                title="Ouvrir la fiche complète (⌘O)"
              >
                <span className="hidden sm:inline">Fiche complète</span>
              </Button>
            </div>
          </div>

          {/* Tabs */}
          <div className="mt-4">
            <Tabs
              items={tabItems}
              value={tab}
              onChange={(v) => setTab(v as TabKey)}
              variant="line"
              size="sm"
            />
          </div>
        </header>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
          {/* Tab Statut */}
          {tab === "status" && (
            <>
              <FormField label="Statut">
                <Combobox
                  value={status}
                  onChange={(v) => setStatus(v as SlotStatus)}
                  options={statusOptions}
                  placeholder="Choisir un statut"
                  emptyMessage="Aucun statut"
                />
              </FormField>

              <FormField label="Notes internes" help="Visible uniquement par l'équipe interne.">
                <Textarea
                  value={notes}
                  onChange={setNotes}
                  rows={4}
                  placeholder="Notes privées, instructions…"
                />
              </FormField>

              {/* Render lien rapide si dispo */}
              {slot.render && (
                <div className="rounded-xl bg-white/40 backdrop-blur-[8px] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_0_1px_rgba(15,23,42,0.06)]">
                  <p className="text-[11px] text-gray-500 mb-1">Rendu final</p>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] text-gray-700">
                      Statut : <span className="font-medium">{slot.render.status}</span>
                    </span>
                    {(slot.render.videoUrl || slot.render.pngUrl) && (
                      <a
                        href={slot.render.videoUrl ?? slot.render.pngUrl ?? "#"}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] text-sky-700 hover:underline"
                      >
                        Voir <ExternalLink size={10} />
                      </a>
                    )}
                  </div>
                </div>
              )}

              {/* Lien rapide Générer pour slots one-off avec templateId */}
              {!isRestricted && slot.templateId && (
                <a
                  href={`/generate/${slot.templateId}?accountId=${slot.accountId}&slotId=${slot.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-[13px] text-sky-700 rounded-md bg-sky-50/60 backdrop-blur-[8px] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_0_1px_rgba(125,180,210,0.3)] hover:bg-sky-50/85 transition-colors"
                >
                  <Clapperboard size={13} />
                  Ouvrir le formulaire de génération
                </a>
              )}
            </>
          )}

          {/* Tab Assignations */}
          {tab === "assignees" && !isRestricted && (
            <>
              <FormField label="Vidéaste">
                <AssigneePicker
                  value={assigneeVideasteId || null}
                  onChange={(id) => setAssigneeVideasteId(id ?? "")}
                  users={videasteUsers.map((u) => ({
                    id: u.id,
                    name: u.name ?? u.id,
                    email: u.email ?? undefined,
                    role: u.role,
                  }))}
                  allowedRoles={["VIDEASTE", "ADMIN"]}
                  placeholder="Aucun vidéaste"
                  groupByRole={false}
                />
              </FormField>
              <FormField label="Monteur">
                <AssigneePicker
                  value={assigneeMonteurId || null}
                  onChange={(id) => setAssigneeMonteurId(id ?? "")}
                  users={monteurUsers.map((u) => ({
                    id: u.id,
                    name: u.name ?? u.id,
                    email: u.email ?? undefined,
                    role: u.role,
                  }))}
                  allowedRoles={["MONTEUR", "ADMIN"]}
                  placeholder="Aucun monteur"
                  groupByRole={false}
                />
              </FormField>
              <FormField label="CM">
                <AssigneePicker
                  value={assigneeCmId || null}
                  onChange={(id) => setAssigneeCmId(id ?? "")}
                  users={cmUsers.map((u) => ({
                    id: u.id,
                    name: u.name ?? u.id,
                    email: u.email ?? undefined,
                    role: u.role,
                  }))}
                  allowedRoles={["CM", "ADMIN"]}
                  placeholder="Aucun CM"
                  groupByRole={false}
                />
              </FormField>
            </>
          )}

          {/* Tab Overrides */}
          {tab === "overrides" && !isRestricted && (
            <>
              <p className="text-[11px] text-gray-500 mb-1">
                Override la config héritée du pattern pour ce slot uniquement.
                La validation client est gérée dans la fiche publication.
              </p>

              <OverrideControl
                label="Validation admin du montage"
                inheritedValue={
                  slot.pattern?.needsAdminValidation ? "Oui" : "Non"
                }
                isOverriden={needsAdminValidationOverride !== null}
                onToggleOverride={(v) =>
                  setNeedsAdminValidationOverride(v ? !slot.pattern?.needsAdminValidation : null)
                }
              >
                <Combobox
                  value={String(needsAdminValidationOverride ?? false)}
                  onChange={(v) => setNeedsAdminValidationOverride(v === "true")}
                  options={[
                    { value: "true", label: "Forcer : Oui" },
                    { value: "false", label: "Forcer : Non" },
                  ]}
                />
              </OverrideControl>

              <OverrideControl
                label="Sous-titres auto"
                inheritedValue={slot.pattern?.needsCaptions ? "Oui" : "Non"}
                isOverriden={needsCaptionsOverride !== null}
                onToggleOverride={(v) =>
                  setNeedsCaptionsOverride(v ? !slot.pattern?.needsCaptions : null)
                }
              >
                <Combobox
                  value={String(needsCaptionsOverride ?? false)}
                  onChange={(v) => setNeedsCaptionsOverride(v === "true")}
                  options={[
                    { value: "true", label: "Forcer : Oui" },
                    { value: "false", label: "Forcer : Non" },
                  ]}
                />
              </OverrideControl>

              {/* Preset captions si captions actives (héritées ou override) */}
              {(needsCaptionsOverride === true ||
                (needsCaptionsOverride === null && slot.pattern?.needsCaptions)) &&
                captionPresets.length > 0 && (
                  <FormField label="Preset captions (override)" help="Hérité du pattern si non choisi.">
                    <Combobox
                      value={captionPresetIdOverride ?? ""}
                      onChange={(v) => setCaptionPresetIdOverride(v === "" ? null : v)}
                      options={[
                        { value: "", label: "Hérité du pattern" },
                        ...captionPresets.map((p) => ({ value: p.id, label: p.name })),
                      ]}
                    />
                  </FormField>
                )}

              <OverrideControl
                label="Description"
                inheritedValue={
                  DESCRIPTION_OPTIONS.find((o) => o.value === (slot.pattern?.needsDescription ?? "none"))
                    ?.label ?? "Aucune"
                }
                isOverriden={needsDescriptionOverride !== null}
                onToggleOverride={(v) =>
                  setNeedsDescriptionOverride(v ? slot.pattern?.needsDescription ?? "none" : null)
                }
              >
                <Combobox
                  value={needsDescriptionOverride ?? "none"}
                  onChange={(v) => setNeedsDescriptionOverride(v)}
                  options={DESCRIPTION_OPTIONS}
                />
              </OverrideControl>

              {/* Prompt IA si autoGenerate */}
              {(needsDescriptionOverride === "autoGenerate" ||
                (needsDescriptionOverride === null &&
                  slot.pattern?.needsDescription === "autoGenerate")) &&
                descriptionPrompts.length > 0 && (
                  <FormField label="Prompt IA description (override)" help="Hérité du pattern si non choisi.">
                    <Combobox
                      value={descriptionPromptIdOverride ?? ""}
                      onChange={(v) => setDescriptionPromptIdOverride(v === "" ? null : v)}
                      options={[
                        { value: "", label: "Hérité du pattern" },
                        ...descriptionPrompts.map((p) => ({ value: p.id, label: p.name })),
                      ]}
                    />
                  </FormField>
                )}

              <OverrideControl
                label="Mode cover"
                inheritedValue={
                  COVER_MODE_OPTIONS.find((o) => o.value === (slot.pattern?.coverMode ?? "none"))
                    ?.label ?? "Pas de cover"
                }
                isOverriden={coverModeOverride !== null}
                onToggleOverride={(v) =>
                  setCoverModeOverride(v ? slot.pattern?.coverMode ?? "none" : null)
                }
              >
                <Combobox
                  value={coverModeOverride ?? "none"}
                  onChange={(v) => setCoverModeOverride(v)}
                  options={COVER_MODE_OPTIONS}
                />
              </OverrideControl>

              <OverrideControl
                label="Rushes attendus"
                inheritedValue={slot.pattern?.needsRushes ? "Oui" : "Non"}
                isOverriden={needsRushesOverride !== null}
                onToggleOverride={(v) =>
                  setNeedsRushesOverride(v ? !slot.pattern?.needsRushes : null)
                }
              >
                <Combobox
                  value={String(needsRushesOverride ?? false)}
                  onChange={(v) => setNeedsRushesOverride(v === "true")}
                  options={[
                    { value: "true", label: "Forcer : Oui" },
                    { value: "false", label: "Forcer : Non" },
                  ]}
                />
              </OverrideControl>

              <OverrideControl
                label="Brief éditorial"
                inheritedValue={slot.pattern?.needsBrief ? "Oui" : "Non"}
                isOverriden={needsBriefOverride !== null}
                onToggleOverride={(v) =>
                  setNeedsBriefOverride(v ? !slot.pattern?.needsBrief : null)
                }
              >
                <Combobox
                  value={String(needsBriefOverride ?? false)}
                  onChange={(v) => setNeedsBriefOverride(v === "true")}
                  options={[
                    { value: "true", label: "Forcer : Oui" },
                    { value: "false", label: "Forcer : Non" },
                  ]}
                />
              </OverrideControl>
            </>
          )}

          {/* Tab Planning */}
          {tab === "planning" && !isRestricted && (
            <>
              <FormField label="Date">
                <DatePicker value={planDate} onChange={setPlanDate} />
              </FormField>
              <FormField label="Heure">
                <TimePicker value={planTime} onChange={setPlanTime} />
              </FormField>
              <p className="text-[11px] text-gray-500">
                Modifier la date/heure replanifie le slot. Les jobs déjà déclenchés
                ne sont pas affectés.
              </p>
            </>
          )}

          {error && (
            <p
              className="text-[12px] text-rose-700 bg-rose-50/80 backdrop-blur-[8px] rounded-md px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_0_1px_rgba(201,113,133,0.18)]"
              role="alert"
            >
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <footer className="shrink-0 flex items-center gap-2 px-5 py-3 bg-white/30 border-t border-white/30">
          {!isRestricted &&
            slot.status !== "CANCELLED" &&
            slot.status !== "ARCHIVED" &&
            slot.status !== "PUBLISHED" && (
              <Button
                variant="ghost"
                size="sm"
                icon={Ban}
                onClick={() => setConfirmCancel(true)}
                disabled={saving}
                title="Marquer comme annulé"
              >
                <span className="hidden sm:inline">Annuler</span>
              </Button>
            )}
          {!isRestricted && (
            <Button
              variant="danger"
              size="sm"
              icon={Trash2}
              onClick={() => setConfirmDeleteOpen(true)}
              disabled={deleting}
              title="Supprimer définitivement"
            >
              <span className="sr-only">Supprimer</span>
            </Button>
          )}

          <div className="flex-1" />

          <Button variant="ghost" size="sm" onClick={onClose}>
            Fermer
          </Button>
          <Button
            variant="primary"
            size="sm"
            icon={Save}
            onClick={() => {
              void handleSave();
            }}
            loading={saving}
          >
            Sauvegarder
          </Button>
        </footer>
      </Drawer>
    </>
  );
}
