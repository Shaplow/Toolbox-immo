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

import { CAPTIONS_MODE_LABELS_FR, normalizeCaptionsMode } from "@/lib/publications/captionsMode";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Ban,
  Copy,
  ExternalLink,
  Trash2,
  Save,
  ListChecks,
  SlidersHorizontal,
  Clapperboard,
  MoreHorizontal,
  ChevronUp,
  ChevronDown,
  Sparkles,
} from "lucide-react";
import { useKeybindings } from "@/hooks/useKeybindings";
import { useAutoSave } from "@/hooks/useAutoSave";
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
import { ButtonIcon } from "@/components/ui/ButtonIcon";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { FormField } from "@/components/ui/FormField";
import { SlotPropertySelect } from "@/components/publications/SlotPropertySelect";
import { Textarea } from "@/components/ui/Textarea";
import { Combobox } from "@/components/ui/Combobox";
import { DatePicker } from "@/components/ui/DatePicker";
import { TimePicker } from "@/components/ui/TimePicker";
import { AssigneePicker } from "@/components/ui/molecules/AssigneePicker";
import { OverrideControl } from "@/components/ui/molecules/OverrideControl";
import { toast } from "@/components/ui/Toast";
import { DropdownMenu } from "@/components/ui/DropdownMenu";
import { resolveNextActionInfo } from "@/lib/publications/nextActionLabel";

export type SlotDetailPanelMode = "admin" | "monteur" | "cm";

interface SlotDetailPanelProps {
  slot: PublicationSlot;
  onUpdated: (slot: PublicationSlot) => void;
  onDeleted: (id: string) => void;
  /** Phase 4 — duplication : clone créé via POST, remonté pour insertion locale. */
  onDuplicated?: (slot: PublicationSlot) => void;
  onClose: () => void;
  mode?: SlotDetailPanelMode;
  /**
   * V8 Phase 5 — Navigation cursor entre slots de la liste filtrée.
   * Optionnels : si pas fournis, les boutons ↑↓ ne s'affichent pas.
   */
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
}

const STATUSES = Object.keys(STATUS_LABELS) as SlotStatus[];

const RESERVED_TERMINAL_FOR_SELECT = new Set<SlotStatus>([
  "PUBLISHED",
  "CANCELLED",
  "ARCHIVED",
]);

type TabKey = "status" | "config";

interface UserOpt {
  id: string;
  name: string | null;
  role: string;
  email?: string | null;
}

// Phase mapping description override
const DESCRIPTION_OPTIONS = [
  { value: "none", label: "Aucune" },
  { value: "preFilled", label: "Pré-remplie par bien" },
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
  onDuplicated,
  onClose,
  mode = "admin",
  onPrev,
  onNext,
  hasPrev,
  hasNext,
}: SlotDetailPanelProps) {
  const isRestricted = mode !== "admin";
  const router = useRouter();

  // V8 Phase 5 — Auto-save sur le textarea Notes (cas le plus fréquent).
  // Patch partiel "notes only" via debounce 800ms. Les autres champs
  // (planning, équipe, overrides) gardent le bouton Sauvegarder global
  // pour cette phase MVP. Phase 10 étendra l'auto-save aux autres champs.
  const autoSaveNotes = useAutoSave<{ notes: string | null }>(
    async (patch) => {
      const res = await fetch(`/api/calendar/slots/${slot.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Erreur ${res.status}`);
      }
      const parsed = (await res.json()) as PublicationSlot;
      onUpdated(parsed);
    },
  );

  // V8 Phase 5 — Raccourcis nav cursor + ⌘O.
  useKeybindings([
    { key: "ArrowDown", handler: () => onNext?.(), when: () => !!hasNext },
    { key: "j", handler: () => onNext?.(), when: () => !!hasNext },
    { key: "ArrowUp", handler: () => onPrev?.(), when: () => !!hasPrev },
    { key: "k", handler: () => onPrev?.(), when: () => !!hasPrev },
    {
      key: "o+Meta",
      handler: () => router.push(`/publications/${slot.id}`),
    },
  ]);

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
  // null = hérite de la recette ; sinon "none" | "auto" | "manual".
  const [needsCaptionsModeOverride, setNeedsCaptionsModeOverride] = useState<string | null>(
    slot.needsCaptionsModeOverride ?? null,
  );
  const [needsDescriptionOverride, setNeedsDescriptionOverride] = useState<string | null>(
    slot.needsDescriptionOverride ?? null,
  );
  // P0 — OverrideControl "Rushes attendus" retiré de l'UI (dérivé de source).
  // Le state lit la valeur DB existante pour la repropager au save sans la
  // modifier — préserve la rétro-compatibilité des slots déjà overridés.
  const [needsRushesOverride] = useState<boolean | null>(
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
  // slot.scheduledAt peut être null pour les slots en banque — on initialise
  // les inputs vides dans ce cas (l'admin remplit pour sortir de la banque).
  const scheduledDate = useMemo(
    () => (slot.scheduledAt ? new Date(slot.scheduledAt) : null),
    [slot.scheduledAt],
  );
  const initialDateStr = useMemo(
    () => (scheduledDate ? scheduledDate.toISOString().slice(0, 10) : ""),
    [scheduledDate],
  );
  const initialTimeStr = useMemo(() => {
    if (!scheduledDate) return "";
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
  const [duplicating, setDuplicating] = useState(false);
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
          needsCaptionsModeOverride,
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
    needsCaptionsModeOverride,
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

  // Phase 4 — Duplication : clone daté au jour suivant (même heure), en
  // réutilisant le contrat createSlot (POST /api/calendar/slots). On recopie
  // compte, recette, équipe et overrides ; pas de status/version (clone vierge,
  // statut initial recalculé serveur).
  async function handleDuplicate() {
    if (!slot.scheduledAt) return;
    setDuplicating(true);
    setError(null);
    try {
      const next = new Date(slot.scheduledAt);
      next.setDate(next.getDate() + 1);
      const res = await fetch("/api/calendar/slots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: slot.accountId,
          scheduledAt: next.toISOString(),
          title: slot.title ?? undefined,
          patternBindingId: slot.patternBindingId ?? undefined,
          assigneeMonteurId: slot.assigneeMonteurId ?? undefined,
          assigneeCmId: slot.assigneeCmId ?? undefined,
          assigneeVideasteId: slot.assigneeVideasteId ?? undefined,
          needsCaptionsModeOverride: slot.needsCaptionsModeOverride ?? undefined,
          needsDescriptionOverride: slot.needsDescriptionOverride ?? undefined,
          needsRushesOverride: slot.needsRushesOverride ?? undefined,
          needsBriefOverride: slot.needsBriefOverride ?? undefined,
          coverModeOverride: slot.coverModeOverride ?? undefined,
          captionPresetIdOverride: slot.captionPresetIdOverride ?? undefined,
          descriptionPromptIdOverride: slot.descriptionPromptIdOverride ?? undefined,
        }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? `Erreur ${res.status}`);
      }
      const created = (await res.json()) as PublicationSlot;
      onDuplicated?.(created);
      toast.success("Publication dupliquée au jour suivant");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur inconnue";
      setError(msg);
      toast.error(msg);
    } finally {
      setDuplicating(false);
    }
  }

  // ─── Tabs configuration ────────────────────────────────────────────────
  // P1 — 4 tabs → 2 tabs. "Configuration" regroupe Planning + Équipe +
  // Ajustements via des CollapsibleSection internes (planning en haut car
  // action fréquente, ajustements en bas replié car action rare).
  // V8 Phase 5 — Renommé "Équipe & Planning" → "Configuration" (plus court,
  // plus stable visuellement avec auto-save persistant en header).
  const tabItems = isRestricted
    ? [{ id: "status", label: "Statut", icon: ListChecks }]
    : [
        { id: "status", label: "Statut", icon: ListChecks },
        { id: "config", label: "Configuration", icon: SlidersHorizontal },
      ];

  const dateLabel = scheduledDate
    ? scheduledDate.toLocaleDateString("fr-FR", {
        weekday: "long",
        day: "numeric",
        month: "long",
      })
    : "En banque · non programmé";
  const timeLabel = scheduledDate
    ? scheduledDate.toLocaleTimeString("fr-FR", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

  const title = slot.pattern?.label ?? slot.title ?? "Publication";

  return (
    <>
      <ConfirmDialog
        open={confirmCancel}
        title="Annuler cette mission ?"
        description="La publication passera au statut « Annulée ». Aucune donnée n'est supprimée — l'historique reste consultable."
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
        title="Supprimer cette publication ?"
        description="Cette action est irréversible. La publication et toutes ses données associées seront supprimées."
        confirmLabel="Supprimer"
        variant="danger"
        loading={deleting}
        onConfirm={() => {
          void handleDeleteConfirmed();
        }}
        onCancel={() => setConfirmDeleteOpen(false)}
      />

      <Drawer open onClose={onClose} side="right" size="lg">
        {/* Header drawer custom — title + meta + héritage recette + actions */}
        <header className="shrink-0 px-5 pt-5 pb-3 border-b border-border">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-[18px] font-semibold tracking-tight text-foreground truncate leading-tight">
                {title}
              </h2>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {dateLabel} · {timeLabel} ·{" "}
                {slot.account ? (
                  <Link
                    href={`/admin/accounts/${slot.accountId}`}
                    className="hover:text-foreground transition-colors"
                  >
                    @{slot.account.handle}
                  </Link>
                ) : (
                  <span>Sans compte</span>
                )}
              </p>
              {slot.pattern?.label && (
                <p className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Sparkles size={11} className="shrink-0" />
                  <span>Recette :</span>
                  {slot.account ? (
                    <Link
                      href={`/admin/accounts/${slot.accountId}`}
                      className="text-foreground hover:underline truncate max-w-[18ch]"
                      title={`Éditer la recette « ${slot.pattern.label} » sur @${slot.account.handle}`}
                    >
                      {slot.pattern.label}
                    </Link>
                  ) : (
                    <span className="text-foreground truncate max-w-[18ch]" title={slot.pattern.label}>
                      {slot.pattern.label}
                    </span>
                  )}
                </p>
              )}
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {/* V8 Phase 5 — Cursor prev/next (si onPrev/onNext fournis).
                  Raccourcis : ↑/↓ ou K/J. */}
              {(onPrev || onNext) && (
                <div className="inline-flex items-center gap-0.5 mr-1">
                  <ButtonIcon
                    icon={ChevronUp}
                    label="Publication précédente (↑ ou K)"
                    variant="ghost"
                    size="sm"
                    onClick={() => onPrev?.()}
                    disabled={!hasPrev}
                  />
                  <ButtonIcon
                    icon={ChevronDown}
                    label="Publication suivante (↓ ou J)"
                    variant="ghost"
                    size="sm"
                    onClick={() => onNext?.()}
                    disabled={!hasNext}
                  />
                </div>
              )}
              {/* V8 Phase 5 — Indicateur auto-save (notes) discret. */}
              {autoSaveNotes.status !== "idle" && (
                <span
                  className={[
                    "inline-flex items-center px-2 h-7 rounded-md text-[11px] font-medium mr-1",
                    autoSaveNotes.status === "saving"
                      ? "text-muted-foreground bg-muted/70"
                      : autoSaveNotes.status === "saved"
                        ? "text-success-700 bg-success-100/70"
                        : "text-danger-700 bg-danger-100/70",
                  ].join(" ")}
                  title={autoSaveNotes.error ?? undefined}
                >
                  {autoSaveNotes.status === "saving"
                    ? "Sauvegarde…"
                    : autoSaveNotes.status === "saved"
                      ? "Sauvegardé"
                      : "Erreur"}
                </span>
              )}
              <Button
                variant="secondary"
                size="sm"
                icon={ExternalLink}
                onClick={() => router.push(`/publications/${slot.id}`)}
                title="Ouvrir la fiche complète (⌘O)"
              >
                <span className="hidden sm:inline">Fiche complète</span>
              </Button>
              {/* Phase 3 — actions destructives déplacées du footer vers
                  ce menu pour ne plus risquer de cliquer "Annuler la mission"
                  alors qu'on voulait juste fermer le drawer. */}
              {!isRestricted && (
                <DropdownMenu
                  align="end"
                  trigger={
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={MoreHorizontal}
                      title="Plus d'actions"
                    >
                      <span className="sr-only">Plus d&apos;actions</span>
                    </Button>
                  }
                  items={[
                    ...(slot.scheduledAt
                      ? ([
                          {
                            label: duplicating
                              ? "Duplication…"
                              : "Dupliquer (jour suivant)",
                            icon: Copy,
                            onClick: () => {
                              void handleDuplicate();
                            },
                          },
                          "separator",
                        ] as const)
                      : []),
                    ...(slot.status !== "CANCELLED" &&
                    slot.status !== "ARCHIVED" &&
                    slot.status !== "PUBLISHED"
                      ? ([
                          {
                            label: "Annuler la mission",
                            icon: Ban,
                            onClick: () => setConfirmCancel(true),
                            destructive: true,
                          },
                          "separator",
                        ] as const)
                      : []),
                    {
                      label: "Supprimer le slot",
                      icon: Trash2,
                      onClick: () => setConfirmDeleteOpen(true),
                      destructive: true,
                    },
                  ]}
                />
              )}
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
              {/* Phase 3 — Friction HIGH #3 du audit UX : avant, le drawer
                  affichait uniquement un Combobox de statuts techniques sans
                  expliquer qui doit agir maintenant et sur quoi. Désormais
                  bandeau contextuel calculé depuis le statut + assignés. */}
              {(() => {
                const info = resolveNextActionInfo(slot.status, {
                  assigneeMonteurId: slot.assigneeMonteurId,
                  assigneeCmId: slot.assigneeCmId,
                  assigneeVideasteId: slot.assigneeVideasteId,
                  assigneeMonteurName: slot.assigneeMonteur?.name ?? null,
                  assigneeCmName: slot.assigneeCm?.name ?? null,
                  assigneeVideasteName: slot.assigneeVideaste?.name ?? null,
                });
                if (!info) return null;
                const who = info.assigneeName
                  ? `${info.ownerLabel} ${info.assigneeName}`
                  : info.ownerLabel;
                return (
                  <div className="rounded-xl bg-gradient-to-b from-success-50/80 to-success-50/40 px-4 py-3 ">
                    <p className="text-[10px] uppercase tracking-widest font-semibold text-success-700">
                      Prochaine action attendue
                    </p>
                    <p className="mt-1 text-[13px] text-success-700 leading-snug">
                      {info.action}
                    </p>
                    <p className="mt-0.5 text-[11px] text-success-700/80">
                      Par {who}
                    </p>
                  </div>
                );
              })()}

              <FormField label="Statut">
                <Combobox
                  value={status}
                  onChange={(v) => setStatus(v as SlotStatus)}
                  options={statusOptions}
                  placeholder="Choisir un statut"
                  emptyMessage="Aucun statut"
                />
              </FormField>

              <FormField label="Bien" help="Fiche partagée (adresse, prix…) qui préremplit la génération. Éditée une fois, propagée.">
                <SlotPropertySelect slotId={slot.id} initialPropertyId={slot.propertyId} />
              </FormField>

              <FormField label="Notes internes" help="Visible uniquement par l'équipe interne. Auto-sauvegardé.">
                <Textarea
                  value={notes}
                  onChange={(v) => {
                    setNotes(v);
                    autoSaveNotes.enqueue({ notes: v || null });
                  }}
                  rows={4}
                  placeholder="Notes privées, instructions…"
                />
              </FormField>

              {/* Render lien rapide si dispo */}
              {slot.render && (
                <div className="rounded-xl bg-card border border-border px-4 py-3 ">
                  <p className="text-[11px] text-muted-foreground mb-1">Rendu final</p>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] text-foreground">
                      Statut : <span className="font-medium">{slot.render.status}</span>
                    </span>
                    {(slot.render.videoUrl || slot.render.pngUrl) && (
                      <a
                        href={slot.render.videoUrl ?? slot.render.pngUrl ?? "#"}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] text-info-700 hover:underline"
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
                  href={`/generate/${slot.templateId}?${slot.accountId ? `accountId=${slot.accountId}&` : ""}slotId=${slot.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-[13px] text-info-700 rounded-md bg-info-50/60  hover:bg-info-50/85 transition-colors"
                >
                  <Clapperboard size={13} />
                  Ouvrir le formulaire de génération
                </a>
              )}
            </>
          )}

          {/* Tab Configuration — fusion de Planning + Équipe + Ajustements
              en CollapsibleSection. Planning ouvert (date = action fréquente),
              Équipe ouverte, Ajustements replié (action rare per-slot). */}
          {tab === "config" && !isRestricted && (
            <>
              <CollapsibleSection
                title="Planning"
                defaultOpen
                storageKey="slot-panel:planning"
              >
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <FormField label="Date">
                    <DatePicker value={planDate} onChange={setPlanDate} />
                  </FormField>
                  <FormField label="Heure">
                    <TimePicker value={planTime} onChange={setPlanTime} />
                  </FormField>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Modifier la date/heure replanifie le slot. Les jobs déjà déclenchés
                  ne sont pas affectés.
                </p>
              </CollapsibleSection>

              <CollapsibleSection
                title="Équipe assignée"
                defaultOpen
                storageKey="slot-panel:team"
              >
                <div className="space-y-3 pt-1">
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
                </div>
              </CollapsibleSection>

              <CollapsibleSection
                title="Ajustements · overrides du pattern"
                defaultOpen={false}
                storageKey="slot-panel:overrides"
              >
                <div className="rounded-lg bg-card border border-border px-4 py-3 mt-1 ">
                  <p className="text-[11px] text-foreground leading-relaxed">
                    Ajuste pour ce slot uniquement les valeurs héritées du
                    pattern. Tant qu&apos;un champ reste « hérité », il suivra le
                    pattern à chaque modification. La validation client se gère
                    dans la fiche publication.
                  </p>
                </div>

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
                label="Sous-titres"
                inheritedValue={
                  CAPTIONS_MODE_LABELS_FR[
                    normalizeCaptionsMode(slot.pattern?.needsCaptionsMode)
                  ]
                }
                isOverriden={needsCaptionsModeOverride !== null}
                onToggleOverride={(v) =>
                  setNeedsCaptionsModeOverride(
                    v ? normalizeCaptionsMode(slot.pattern?.needsCaptionsMode) : null,
                  )
                }
              >
                <Combobox
                  value={needsCaptionsModeOverride ?? "none"}
                  onChange={(v) => setNeedsCaptionsModeOverride(v)}
                  options={[
                    { value: "none", label: "Aucun sous-titre" },
                    { value: "auto", label: "Auto (preset + IA)" },
                    { value: "manual", label: "Manuel (écrits à la main)" },
                  ]}
                />
              </OverrideControl>

              {/* Preset captions si captions actives (héritées ou override) */}
              {(needsCaptionsModeOverride === "auto" ||
                (needsCaptionsModeOverride === null &&
                  slot.pattern?.needsCaptionsMode === "auto")) &&
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

              {/* P0 — "Rushes attendus" retiré de l'UI : la valeur est
                  dérivée automatiquement de pattern.source (manual_rushes →
                  true, sinon false). Le champ Prisma reste pour rétrocompat
                  et l'override exceptionnel via API. */}

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
              </CollapsibleSection>
            </>
          )}

          {error && (
            <p
              className="text-[12px] text-danger-700 bg-danger-50/80 rounded-md px-3 py-2 "
              role="alert"
            >
              {error}
            </p>
          )}
        </div>

        {/* Footer — navigation pure : pas d'actions destructives ici. Annuler
            mission + Supprimer ont migré dans le DropdownMenu du header pour
            éviter la confusion "Annuler la mission" ≠ "Annuler la modal". */}
        <footer className="shrink-0 flex items-center justify-end gap-2 px-5 py-3 bg-card border-t border-border">
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
