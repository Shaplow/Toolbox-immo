"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  RefreshCw,
  CalendarDays,
  Sparkles,
  Filter,
  X,
  Inbox,
  Calendar as CalendarIcon,
  CheckSquare,
  Square,
  UserCheck,
  Ban,
  CheckCircle,
  Clapperboard,
} from "lucide-react";
import { DAY_LABELS, type PublicationSlot } from "@/types/calendar";
import { resolveSlotOwner } from "@/lib/slots/statusLabels";
import type { UserRole } from "@/types/roles";
import { SlotCard } from "./SlotCard";
import { SlotDetailPanel, type SlotDetailPanelMode } from "./SlotDetailPanel";
import { AddSlotModal } from "./AddSlotModal";
import { BankView } from "./BankView";
import { BankRail } from "./BankRail";
import { isReadyToSchedule } from "@/lib/slots/bankReady";
import { BulkReassignModal } from "./BulkReassignModal";
import { BulkShiftDateModal } from "./BulkShiftDateModal";
import { BulkCancelModal } from "./BulkCancelModal";
import { BulkMarkPublishedModal } from "./BulkMarkPublishedModal";
import { BULK_PUBLISHABLE_STATUSES } from "@/lib/publications/constants";
import { ScheduleFromBankModal } from "./ScheduleFromBankModal";
import { CalendarFilters, type CalendarFiltersState } from "./CalendarFilters";
import { CalendarDndContext, type SlotDropPayload } from "./dnd/CalendarDndContext";
import { useSlotDrag } from "./dnd/useSlotDrag";
import { useDayDrop } from "./dnd/useDayDrop";
import { toast } from "@/components/ui/Toast";
import { numericDateFr, dayMonthLongFr } from "@/lib/date/formatFr";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Button } from "@/components/ui/Button";
import { ButtonIcon } from "@/components/ui/ButtonIcon";
import { Chip } from "@/components/ui/Chip";
import { Alert } from "@/components/ui/Alert";
import { Tabs } from "@/components/ui/Tabs";

interface Account {
  id: string;
  name: string;
  handle: string;
}

interface AssigneeOption {
  id: string;
  label: string;
}

interface CalendarViewProps {
  accounts: Account[];
  /** ISO string of Monday for the initial week, computed server-side to avoid hydration mismatches. */
  initialWeekStart: string;
  currentUserRole: UserRole;
  currentUserId: string;
  monteurs?: AssigneeOption[];
  cms?: AssigneeOption[];
  videastes?: AssigneeOption[];
  /** Compteur server-side des slots backlog actifs (scopé par rôle). */
  initialBacklogTotal?: number;
  /** Compteur server-side des contenus backlog prêts à programmer. */
  initialBacklogReadyCount?: number;
}

const ROLE_DETAIL_MODE: Record<UserRole, SlotDetailPanelMode> = {
  ADMIN: "admin",
  MONTEUR: "monteur",
  CM: "cm",
  VIDEASTE: "monteur",
  EXTERNAL_GENERATOR: "cm",
};

function getMondayOf(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * True si le focus utilisateur est dans un champ texte. Utilisé pour ignorer
 * les raccourcis clavier (sinon taper "n" dans un Combobox déclenche la modal).
 */
function isInTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable ||
    target.closest("[role=combobox], [role=textbox]") !== null
  );
}

export function CalendarView({
  accounts,
  initialWeekStart,
  currentUserRole,
  currentUserId,
  monteurs = [],
  cms = [],
  videastes = [],
  initialBacklogTotal = 0,
  initialBacklogReadyCount = 0,
}: CalendarViewProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialAccountId = searchParams?.get("accountId") ?? "";
  const kpiFilter = searchParams?.get("filter") ?? "";
  const isAdmin = currentUserRole === "ADMIN";
  const detailMode = ROLE_DETAIL_MODE[currentUserRole];

  const initialWeek = (() => {
    const w = searchParams?.get("week");
    if (w && /^\d{4}-\d{2}-\d{2}$/.test(w)) {
      const parsed = new Date(`${w}T00:00:00`);
      if (!isNaN(parsed.getTime())) return parsed;
    }
    return new Date(initialWeekStart);
  })();

  const initialView: "week" | "bank" =
    searchParams?.get("view") === "bank" ? "bank" : "week";

  const [view, setView] = useState<"week" | "bank">(initialView);
  // Compteurs backlog server-side conservés en state local. Mis à jour
  // optimistiquement quand l'admin crée/programme/supprime des slots banque
  // — évite un refetch à chaque action et garde le badge réactif.
  const [backlogTotal, setBacklogTotal] = useState<number>(initialBacklogTotal);
  const [backlogReadyCount, setBacklogReadyCount] = useState<number>(
    initialBacklogReadyCount,
  );
  const [weekStart, setWeekStart] = useState<Date>(initialWeek);
  const [slots, setSlots] = useState<PublicationSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<PublicationSlot | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [scheduleFromBank, setScheduleFromBank] = useState<PublicationSlot | null>(null);
  const [addDefaultDate, setAddDefaultDate] = useState<string | undefined>(undefined);
  // Phase 2 — rail latéral banque en vue semaine (drag→jour). Slots possédés
  // ici (chargés à l'ouverture) pour pouvoir les retirer après un drop réussi.
  const [showBankRail, setShowBankRail] = useState(false);
  const [bankRailSlots, setBankRailSlots] = useState<PublicationSlot[]>([]);
  const [bankRailLoading, setBankRailLoading] = useState(false);
  // Sprint C — multi-select calendrier admin pour bulk-patch
  // (réassigner monteur/CM/vidéaste, déplacer date, annuler).
  const [bulkSelectMode, setBulkSelectMode] = useState(false);
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<string>>(
    () => new Set(),
  );
  // Phase 7 V2 — split BulkPatchModal en actions focalisées.
  const [bulkAction, setBulkAction] = useState<
    "reassign" | "shift" | "cancel" | "publish" | null
  >(null);
  const [generating, setGenerating] = useState(false);
  const [confirmGenOpen, setConfirmGenOpen] = useState(false);
  // W4.9 : preview dry-run avant confirmation (created/skipped sans insert DB).
  const [genPreview, setGenPreview] = useState<{ created: number; skipped: number } | null>(null);
  const [genPreviewLoading, setGenPreviewLoading] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<CalendarFiltersState>({
    accountId: initialAccountId,
    status: "",
    monteurId: "",
    cmId: "",
    videasteId: "",
    onlyMine: false,
  });

  const filteredAccount = filters.accountId
    ? accounts.find((a) => a.id === filters.accountId) ?? null
    : null;

  function clearAccountFilter() {
    setFilters((f) => ({ ...f, accountId: "" }));
    router.replace("/calendar");
  }

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const dateFrom = weekStart;
  const dateTo = addDays(weekStart, 6);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      // En mode "bank" on charge uniquement les slots sans date programmée,
      // sans aucun filtre date — la banque transcende la semaine.
      const params = new URLSearchParams(
        view === "bank"
          ? {
              bank: "only",
              ...(filters.accountId ? { accountId: filters.accountId } : {}),
              ...(filters.status ? { status: filters.status } : {}),
              ...(filters.monteurId ? { monteurId: filters.monteurId } : {}),
              ...(filters.cmId ? { cmId: filters.cmId } : {}),
              ...(filters.videasteId ? { videasteId: filters.videasteId } : {}),
            }
          : (() => {
              const dateToEnd = new Date(dateTo);
              dateToEnd.setHours(23, 59, 59, 999);
              return {
                dateFrom: dateFrom.toISOString(),
                dateTo: dateToEnd.toISOString(),
                ...(filters.accountId ? { accountId: filters.accountId } : {}),
                ...(filters.status ? { status: filters.status } : {}),
                ...(filters.monteurId ? { monteurId: filters.monteurId } : {}),
                ...(filters.cmId ? { cmId: filters.cmId } : {}),
                ...(filters.videasteId ? { videasteId: filters.videasteId } : {}),
              };
            })(),
      );
      const res = await fetch(`/api/calendar/slots?${params.toString()}`);
      if (!res.ok) throw new Error(`Erreur ${res.status}`);
      const data = (await res.json()) as { slots: PublicationSlot[]; hasMore: boolean };
      setSlots(Array.isArray(data.slots) ? data.slots : []);
      if (data.hasMore) {
        toast.info("Résultat tronqué à 500 slots — affinez les filtres ou la plage de dates.");
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Erreur de chargement");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, weekStart, filters]);

  useEffect(() => {
    void load();
  }, [load]);

  function persistWeek(week: Date) {
    const iso = week.toISOString().slice(0, 10);
    const url = new URL(window.location.href);
    url.searchParams.set("week", iso);
    router.replace(url.pathname + url.search, { scroll: false });
  }

  const prevWeek = useCallback(() => {
    setSlots([]);
    setWeekStart((d) => {
      const nw = addDays(d, -7);
      persistWeek(nw);
      return nw;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nextWeek = useCallback(() => {
    setSlots([]);
    setWeekStart((d) => {
      const nw = addDays(d, 7);
      persistWeek(nw);
      return nw;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goToday = useCallback(() => {
    setSlots([]);
    const nw = getMondayOf(new Date());
    setWeekStart(nw);
    const url = new URL(window.location.href);
    url.searchParams.delete("week");
    router.replace(url.pathname + url.search, { scroll: false });
  }, [router]);

  // Switch entre vue semaine et vue banque — persiste dans l'URL pour
  // que le rechargement (et les liens entrants depuis HomeAdmin KPI) tombent
  // sur la bonne vue. Reset les filtres au switch pour éviter que le compteur
  // KPI (banner HomeAdmin = "5 prêts") diverge de la liste filtrée affichée
  // (= 2 visibles à cause d'un filtre monteur résiduel).
  const switchView = useCallback(
    (next: "week" | "bank") => {
      setView(next);
      setSlots([]);
      setFilters({
        accountId: "",
        status: "",
        monteurId: "",
        cmId: "",
        videasteId: "",
        onlyMine: false,
      });
      const url = new URL(window.location.href);
      if (next === "bank") {
        url.searchParams.set("view", "bank");
        url.searchParams.delete("week");
      } else {
        url.searchParams.delete("view");
      }
      // Clear aussi les query params filtres pour cohérence
      url.searchParams.delete("accountId");
      url.searchParams.delete("filter");
      router.replace(url.pathname + url.search, { scroll: false });
    },
    [router],
  );

  // Phase 7 — raccourcis clavier globaux du calendrier.
  // ⌘N / Ctrl+N : ouvre AddSlotModal (ADMIN only)
  // ← / →       : semaine prev / next
  // T           : recentre sur la semaine courante
  // Guard isInTextField pour ne pas intercepter la saisie dans filtres/combobox.
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (isInTextField(e.target)) return;
      // Ne pas intercepter quand une modal est ouverte (Drawer / AddSlot / Confirm)
      // — sinon ← / → cassent la navigation dans les pickers du drawer.
      if (selectedSlot || showAdd || confirmGenOpen) return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
        if (!isAdmin) return;
        e.preventDefault();
        setAddDefaultDate(undefined);
        setShowAdd(true);
      } else if (e.key === "ArrowLeft" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        prevWeek();
      } else if (e.key === "ArrowRight" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        nextWeek();
      } else if ((e.key === "t" || e.key === "T") && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        goToday();
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isAdmin, prevWeek, nextWeek, goToday, selectedSlot, showAdd, confirmGenOpen]);

  function isSlotMine(slot: PublicationSlot): boolean {
    const owner = resolveSlotOwner(slot);
    if (!owner) return false;
    if (owner === "ADMIN") return currentUserRole === "ADMIN";
    if (owner === "VIDEASTE") return slot.assigneeVideasteId === currentUserId;
    if (owner === "MONTEUR") return slot.assigneeMonteurId === currentUserId;
    if (owner === "CM") return slot.assigneeCmId === currentUserId;
    return false;
  }

  function matchesKpiFilter(slot: PublicationSlot): boolean {
    if (!kpiFilter) return true;
    const now = Date.now();
    const isTerminal =
      slot.status === "PUBLISHED" ||
      slot.status === "CANCELLED" ||
      slot.status === "ARCHIVED";
    switch (kpiFilter) {
      case "overdue":
        return (
          !isTerminal &&
          slot.scheduledAt != null &&
          new Date(slot.scheduledAt).getTime() < now
        );
      case "no-pattern":
        // Sans recette = ni binding ni recette globale (fix résidu G.3 : les
        // slots recette avaient patternId legacy null et étaient comptés à tort).
        return !slot.patternBindingId && !slot.patternTemplateId;
      case "no-monteur":
        return !slot.assigneeMonteurId;
      case "no-videaste":
        return !slot.assigneeVideasteId;
      default:
        return true;
    }
  }

  const visibleSlots = (filters.onlyMine ? slots.filter(isSlotMine) : slots).filter(
    matchesKpiFilter,
  );
  const mineCount = slots.filter(isSlotMine).length;
  const kpiFilteredCount = kpiFilter ? slots.filter(matchesKpiFilter).length : 0;
  // Marquer publié en lot ne porte que sur les créneaux dont la vidéo est validée
  // et qui ont un compte Instagram — mêmes règles que le service, pour annoncer
  // le décompte réel avant validation plutôt que de le découvrir après.
  const bulkPublishableCount = slots.filter(
    (s) =>
      bulkSelectedIds.has(s.id) &&
      s.accountId !== null &&
      BULK_PUBLISHABLE_STATUSES.has(s.status),
  ).length;

  function slotsForDay(day: Date) {
    return visibleSlots
      .filter((s) => s.scheduledAt != null && isSameDay(new Date(s.scheduledAt), day))
      .sort((a, b) => {
        // Tri primaire par heure, puis par compte IG (handle) à heure égale.
        const ta = new Date(a.scheduledAt as string).getTime();
        const tb = new Date(b.scheduledAt as string).getTime();
        if (ta !== tb) return ta - tb;
        // account peut être null (mission sans compte) — ne jamais throw dans le tri.
        return (a.account?.handle ?? "").localeCompare(b.account?.handle ?? "");
      });
  }

  async function handleGenerateConfirmed() {
    setConfirmGenOpen(false);
    setGenerating(true);
    try {
      const dateToEnd = addDays(weekStart, 6);
      dateToEnd.setHours(23, 59, 59, 999);
      const res = await fetch("/api/calendar/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dateFrom: dateFrom.toISOString(),
          dateTo: dateToEnd.toISOString(),
        }),
      });
      if (!res.ok) throw new Error("Erreur lors de la génération");
      const result = (await res.json()) as { created: number; skipped: number };
      toast.success(`${result.created} slot(s) créé(s), ${result.skipped} ignoré(s).`);
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setGenerating(false);
    }
  }

  function handleSlotUpdated(updated: PublicationSlot) {
    setSlots((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    setSelectedSlot((current) =>
      current && current.id === updated.id ? updated : current,
    );
    toast.success("Slot mis à jour");
  }

  function handleSlotDeleted(id: string) {
    setSlots((prev) => prev.filter((s) => s.id !== id));
    setSelectedSlot(null);
    toast.success("Slot supprimé");
  }

  function handleSlotCreated(slot: PublicationSlot) {
    setSlots((prev) => [...prev, slot]);
    setShowAdd(false);
    toast.success("Publication créée");
  }

  // Charge les contenus banque "prêts" pour le rail latéral (vue semaine).
  const loadBankRail = useCallback(async () => {
    setBankRailLoading(true);
    try {
      const res = await fetch("/api/calendar/slots?bank=only");
      if (!res.ok) throw new Error(`Erreur ${res.status}`);
      const data = (await res.json()) as { slots: PublicationSlot[] };
      const ready = (Array.isArray(data.slots) ? data.slots : []).filter(
        isReadyToSchedule,
      );
      setBankRailSlots(ready);
    } catch {
      setBankRailSlots([]);
      toast.error("Impossible de charger la banque");
    } finally {
      setBankRailLoading(false);
    }
  }, []);

  function toggleBankRail() {
    setShowBankRail((open) => {
      const next = !open;
      if (next) void loadBankRail();
      return next;
    });
  }

  // Drag-drop d'une SlotCard sur une colonne-jour (ADMIN only). On conserve
  // l'heure existante du slot et on ne change que le jour ; un slot tiré du rail
  // banque (sans date) tombe à 10:00 par défaut. Update optimiste + rollback.
  const handleSlotDropOnDay = useCallback(
    async ({ slotId, dateIso, fromBank, slot }: SlotDropPayload) => {
      const base = slot.scheduledAt ? new Date(slot.scheduledAt) : null;
      const [y, m, d] = dateIso.split("-").map(Number);
      const target = base ? new Date(base) : new Date();
      target.setFullYear(y, m - 1, d);
      if (!base) target.setHours(10, 0, 0, 0);
      // No-op si on lâche sur le même jour (cas grille uniquement).
      if (!fromBank && base && isSameDay(base, target)) return;
      const newIso = target.toISOString();

      const prevSlots = slots;
      const prevRail = bankRailSlots;
      if (fromBank) {
        // Le slot quitte la banque → on le retire du rail et on l'injecte
        // optimistiquement dans la grille semaine.
        setBankRailSlots((prev) => prev.filter((s) => s.id !== slotId));
        setSlots((prev) => [...prev, { ...slot, scheduledAt: newIso }]);
      } else {
        setSlots((prev) =>
          prev.map((s) => (s.id === slotId ? { ...s, scheduledAt: newIso } : s)),
        );
      }
      try {
        const res = await fetch(`/api/calendar/slots/${slotId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scheduledAt: newIso }),
        });
        if (!res.ok) throw new Error(`Erreur ${res.status}`);
        const updated = (await res.json()) as PublicationSlot;
        setSlots((prev) => prev.map((s) => (s.id === slotId ? updated : s)));
        if (fromBank) {
          const wasReady = isReadyToSchedule(slot);
          setBacklogTotal((prev) => Math.max(0, prev - 1));
          if (wasReady) setBacklogReadyCount((prev) => Math.max(0, prev - 1));
          toast.success("Contenu programmé");
        }
      } catch (err) {
        // Rollback complet (grille + rail).
        setSlots(prevSlots);
        if (fromBank) setBankRailSlots(prevRail);
        toast.error(
          err instanceof Error ? err.message : "Déplacement impossible",
        );
      }
    },
    [slots, bankRailSlots],
  );

  // Fin de semaine : jour + mois long + année, sans équivalent exact dans
  // lib/date/formatFr.ts (dayMonthLongFr n'a pas l'année) — laissé en l'état.
  // eslint-disable-next-line no-restricted-syntax
  const weekEndLabel = addDays(weekStart, 6).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const weekLabel = `${dayMonthLongFr(weekStart)} – ${weekEndLabel}`;

  const today = new Date();
  const isCurrentWeek = isSameDay(weekStart, getMondayOf(today));

  // Compte de filtres actifs (hors onlyMine + accountId qui ont leur propre badge).
  const activeFilterCount =
    (filters.status ? 1 : 0) +
    (filters.monteurId ? 1 : 0) +
    (filters.cmId ? 1 : 0) +
    (filters.videasteId ? 1 : 0);

  function resetFilters() {
    setFilters({
      accountId: "",
      status: "",
      monteurId: "",
      cmId: "",
      videasteId: "",
      onlyMine: false,
    });
  }

  return (
    <div className="flex flex-col h-full">
      {/* I.1 — Header sticky compact (~48px) : tabs + nav semaine + actions */}
      <header className="shrink-0 sticky top-0 z-30 bg-card border-b border-border">
        <div className="px-4 sm:px-6 py-2 flex items-center gap-3 flex-wrap">
          {/* Tabs Calendrier / Missions — compact inline */}
          <Tabs
            variant="line"
            size="sm"
            value={view}
            onChange={(v) => switchView(v as "week" | "bank")}
            items={[
              { id: "week", label: "Calendrier", icon: CalendarIcon },
              {
                id: "bank",
                label: "Missions",
                icon: Inbox,
                badge: backlogTotal > 0 ? (
                  <span
                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold tabular-nums ${
                      backlogReadyCount > 0
                        ? "bg-info-100 text-info-700"
                        : "bg-muted text-foreground"
                    }`}
                    title={
                      backlogReadyCount > 0
                        ? `${backlogTotal} mission${backlogTotal > 1 ? "s" : ""} · ${backlogReadyCount} prête${backlogReadyCount > 1 ? "s" : ""}`
                        : `${backlogTotal} mission${backlogTotal > 1 ? "s" : ""}`
                    }
                  >
                    {backlogReadyCount > 0 ? (
                      <>
                        {backlogTotal}
                        <span className="opacity-60">·</span>
                        <span>{backlogReadyCount}</span>
                      </>
                    ) : (
                      backlogTotal
                    )}
                  </span>
                ) : undefined,
              },
            ]}
          />

          {/* Navigation semaine — visible en vue week uniquement */}
          {view === "week" && (
            <>
              <span className="h-5 w-px bg-border" aria-hidden />
              <div className="inline-flex items-center gap-0.5">
                <ButtonIcon icon={ChevronLeft} label="Semaine précédente (←)" variant="ghost" size="sm" onClick={prevWeek} />
                <Button variant="ghost" size="sm" icon={CalendarDays} onClick={goToday} title="Aujourd'hui (T)" disabled={isCurrentWeek}>
                  Aujourd&apos;hui
                </Button>
                <ButtonIcon icon={ChevronRight} label="Semaine suivante (→)" variant="ghost" size="sm" onClick={nextWeek} />
              </div>
              <span className="text-[12px] font-mono text-foreground tabular-nums inline-flex items-center gap-1.5">
                {isCurrentWeek && <span className="inline-block h-1.5 w-1.5 rounded-full bg-success-600" />}
                {weekLabel}
              </span>
            </>
          )}

          {/* Compteur publications visible */}
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {view === "bank"
              ? `${visibleSlots.length} mission${visibleSlots.length > 1 ? "s" : ""}`
              : `${visibleSlots.length} publication${visibleSlots.length > 1 ? "s" : ""}`}
            {mineCount > 0 &&
              !filters.onlyMine &&
              view === "week" &&
              currentUserRole !== "EXTERNAL_GENERATOR" && (
                <>
                  {" · "}
                  <button
                    type="button"
                    onClick={() => setFilters((f) => ({ ...f, onlyMine: true }))}
                    className="text-primary hover:underline tabular-nums"
                  >
                    {mineCount} pour toi
                  </button>
                </>
              )}
          </span>

          {/* Filtres + actions à droite */}
          <div className="ml-auto inline-flex items-center gap-2 flex-wrap">
            <Chip
              variant={showFilters || activeFilterCount > 0 ? "sky" : "default"}
              icon={Filter}
              selected={showFilters}
              size="sm"
              onClick={() => setShowFilters((s) => !s)}
            >
              Filtres
              {activeFilterCount > 0 && <span className="ml-1 tabular-nums">·{activeFilterCount}</span>}
            </Chip>

            {filteredAccount && (
              <Chip variant="sky" size="sm" onRemove={clearAccountFilter}>
                @{filteredAccount.handle}
              </Chip>
            )}

            {kpiFilter && (
              <Chip variant="peach" size="sm" onRemove={() => router.replace("/calendar")}>
                {kpiFilter === "overdue" && "En retard"}
                {kpiFilter === "no-pattern" && "Sans recette"}
                {kpiFilter === "no-monteur" && "Sans monteur"}
                {kpiFilter === "no-videaste" && "Sans vidéaste"}
                <span className="ml-1 tabular-nums opacity-70">{kpiFilteredCount}</span>
              </Chip>
            )}

            {activeFilterCount > 0 && (
              <ButtonIcon icon={X} label="Réinitialiser filtres" variant="ghost" size="sm" onClick={resetFilters} />
            )}

            <ButtonIcon
              icon={RefreshCw}
              label="Rafraîchir"
              variant="ghost"
              size="sm"
              onClick={() => { void load(); }}
              loading={loading}
            />

            {/* Actions admin contextuelles */}
            <>
                {/* Missions — un seul point d'entrée : le formulaire complet
                    (recette + compte optionnel + bien). */}
                {isAdmin && view === "bank" && (
                  <Button
                    variant="primary"
                    size="sm"
                    icon={Clapperboard}
                    onClick={() => router.push("/missions/new")}
                    title="Créer une mission (recette, compte optionnel, bien)"
                  >
                    Nouvelle mission
                  </Button>
                )}

                {/* Phase 2 — Toggle rail banque (drag→jour, vue semaine admin). */}
                {isAdmin && view === "week" && (
                  <Chip
                    variant={showBankRail ? "sky" : "default"}
                    size="sm"
                    selected={showBankRail}
                    icon={Inbox}
                    onClick={toggleBankRail}
                  >
                    Banque
                    {backlogReadyCount > 0 && (
                      <span className="ml-1 tabular-nums">·{backlogReadyCount}</span>
                    )}
                  </Chip>
                )}

                {/* Sprint C — Toggle sélection multiple (vue semaine admin). */}
                {isAdmin && view === "week" && (
                  <Chip
                    variant={bulkSelectMode ? "sky" : "default"}
                    size="sm"
                    selected={bulkSelectMode}
                    icon={bulkSelectMode ? CheckSquare : Square}
                    onClick={() => {
                      setBulkSelectMode((v) => !v);
                      setBulkSelectedIds(new Set());
                    }}
                  >
                    Sélection
                  </Chip>
                )}

                {isAdmin && view === "week" && (
                  <>
                    <Button
                      variant="primary"
                      size="sm"
                      icon={Plus}
                      onClick={() => {
                        setAddDefaultDate(undefined);
                        setShowAdd(true);
                      }}
                      title="Nouvelle publication (⌘N)"
                    >
                      Nouvelle publication
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={Sparkles}
                      onClick={() => {
                        setConfirmGenOpen(true);
                        setGenPreview(null);
                        setGenPreviewLoading(true);
                        void (async () => {
                          try {
                            const dateToEnd = addDays(weekStart, 6);
                            dateToEnd.setHours(23, 59, 59, 999);
                            const res = await fetch("/api/calendar/generate?dry=true", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                dateFrom: dateFrom.toISOString(),
                                dateTo: dateToEnd.toISOString(),
                              }),
                            });
                            if (res.ok) {
                              const d = (await res.json()) as { created: number; skipped: number };
                              setGenPreview({ created: d.created, skipped: d.skipped });
                            }
                          } finally {
                            setGenPreviewLoading(false);
                          }
                        })();
                      }}
                      loading={generating}
                      title="Génère les publications automatiques basées sur le planning des recettes liées"
                    >
                      <span className="hidden sm:inline">Générer</span>
                    </Button>
                  </>
                )}
            </>
          </div>
        </div>

        {/* Filtres dépliables (sous le sticky bar) */}
        {showFilters && (
          <div className="px-4 sm:px-6 py-2 border-t border-border bg-muted/30">
            <CalendarFilters
              accounts={accounts}
              filters={filters}
              onChange={setFilters}
              monteurs={monteurs}
              cms={cms}
              videastes={videastes}
              hasMineToggle={currentUserRole !== "EXTERNAL_GENERATOR"}
            />
          </div>
        )}
      </header>

      {/* Body scroll */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
          <div className="max-w-7xl mx-auto space-y-4">
            {/* Error */}
            {loadError && (
              <Alert
                variant="danger"
                title="Impossible de charger les publications"
                actions={
                  <Button variant="secondary" size="sm" onClick={() => void load()}>
                    Réessayer
                  </Button>
                }
              >
                {loadError}
              </Alert>
            )}

            {/* Empty state semaine (V3.3) — la grille reste affichée (cliquer
                un jour crée une publication), le bandeau guide l'admin. */}
            {!loading && !loadError && view !== "bank" && visibleSlots.length === 0 && (
              <div className="rounded-lg border border-border bg-card px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                <p className="text-[13px] text-muted-foreground">
                  Aucune publication cette semaine. Crée-en une, ou clique un
                  jour de la grille pour partir d&apos;une date.
                </p>
                {isAdmin && (
                  <Button size="sm" onClick={() => setShowAdd(true)}>
                    Nouvelle publication
                  </Button>
                )}
              </div>
            )}

            {view === "bank" ? (
              <BankView
                slots={visibleSlots}
                loading={loading}
                onOpenSlot={(slot) => setSelectedSlot(slot)}
                onScheduleSlot={(slot) => setScheduleFromBank(slot)}
                onBulkScheduled={(count) => {
                  // Mise à jour optimiste : on retire les slots dont la date a
                  // été posée (refresh complet via load() pour récupérer le
                  // nouvel état canonique).
                  setBacklogTotal((prev) => Math.max(0, prev - count));
                  void load();
                }}
              />
            ) : (
              /* Grille 7 colonnes — densifiée I.1, enveloppée DnD (admin) */
              <CalendarDndContext
                onSlotDrop={handleSlotDropOnDay}
                currentUserRole={currentUserRole}
                currentUserId={currentUserId}
              >
              <div className="flex gap-4 items-start">
              <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7 gap-x-2.5 gap-y-3">
                {loading && slots.length === 0
                  ? weekDays.map((_, i) => <DayCardSkeleton key={i} />)
                  : weekDays.map((day, i) => {
                      const isToday = isSameDay(day, today);
                      const daySlots = slotsForDay(day);
                      return (
                        <DayCard
                          key={i}
                          day={day}
                          label={DAY_LABELS[i]}
                          isToday={isToday}
                          slots={daySlots}
                          isAdmin={isAdmin}
                          dragEnabled={isAdmin && !bulkSelectMode}
                          currentUserRole={currentUserRole}
                          currentUserId={currentUserId}
                          bulkSelectMode={bulkSelectMode}
                          bulkSelectedIds={bulkSelectedIds}
                          onSlotClick={(slot) => {
                            if (bulkSelectMode) {
                              setBulkSelectedIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(slot.id)) next.delete(slot.id);
                                else next.add(slot.id);
                                return next;
                              });
                            } else {
                              router.push(`/publications/${slot.id}`);
                            }
                          }}
                          onSlotOpenDrawer={(slot) => setSelectedSlot(slot)}
                          onAddSlot={() => {
                            setAddDefaultDate(day.toISOString().slice(0, 10));
                            setShowAdd(true);
                          }}
                        />
                      );
                    })}
              </div>
              {isAdmin && showBankRail && (
                <BankRail
                  slots={bankRailSlots}
                  loading={bankRailLoading}
                  onClose={() => setShowBankRail(false)}
                  onScheduleSlot={(slot) => setScheduleFromBank(slot)}
                />
              )}
              </div>
              </CalendarDndContext>
            )}
          </div>
        </div>

      {/* Drawer détail slot — key={slot.id} force remontage au switch slot.
          V8 Phase 5 — Nav cursor prev/next via la liste de slots affichés
          dans la semaine/banque courante (filtres déjà appliqués côté API). */}
      {selectedSlot && (() => {
        const currentIdx = slots.findIndex((s) => s.id === selectedSlot.id);
        const hasPrev = currentIdx > 0;
        const hasNext = currentIdx >= 0 && currentIdx < slots.length - 1;
        const goPrev = hasPrev ? () => setSelectedSlot(slots[currentIdx - 1]) : undefined;
        const goNext = hasNext ? () => setSelectedSlot(slots[currentIdx + 1]) : undefined;
        return (
          <SlotDetailPanel
            key={selectedSlot.id}
            slot={selectedSlot}
            onUpdated={handleSlotUpdated}
            onDeleted={handleSlotDeleted}
            onDuplicated={(created) => {
              // Le clone tombe au jour suivant : il n'apparaît dans la grille
              // que s'il reste dans la semaine affichée. Sinon, refresh léger.
              if (
                created.scheduledAt &&
                new Date(created.scheduledAt) >= dateFrom &&
                new Date(created.scheduledAt) <= addDays(dateTo, 1)
              ) {
                setSlots((prev) => [...prev, created]);
              }
            }}
            onClose={() => setSelectedSlot(null)}
            mode={detailMode}
            onPrev={goPrev}
            onNext={goNext}
            hasPrev={hasPrev}
            hasNext={hasNext}
          />
        );
      })()}

      {/* Modal création slot */}
      {showAdd && (
        <AddSlotModal
          accounts={accounts}
          defaultDate={addDefaultDate}
          onCreated={handleSlotCreated}
          onClose={() => setShowAdd(false)}
        />
      )}

      {/* Modal de programmation depuis la banque */}
      {scheduleFromBank && (
        <ScheduleFromBankModal
          slot={scheduleFromBank}
          onScheduled={(slotId) => {
            // Le slot quitte la banque — on l'enlève de la liste locale et on
            // décrémente les compteurs. Si le slot programmé était dans la
            // catégorie "ready" (currentVersion + status finalisable),
            // décrémente aussi readyCount.
            const scheduledSlot = scheduleFromBank;
            const wasReady =
              scheduledSlot.currentVersionId != null &&
              (scheduledSlot.status === "EDIT_APPROVED" ||
                scheduledSlot.status === "READY_FOR_CM");
            setBacklogTotal((prev) => Math.max(0, prev - 1));
            if (wasReady) {
              setBacklogReadyCount((prev) => Math.max(0, prev - 1));
            }
            setSlots((prev) => prev.filter((s) => s.id !== slotId));
            // Si la programmation venait du rail banque, retire aussi l'item.
            setBankRailSlots((prev) => prev.filter((s) => s.id !== slotId));
          }}
          onClose={() => setScheduleFromBank(null)}
        />
      )}

      {/* Sprint C — Sticky bar multi-select calendrier (vue semaine admin).
          Phase 7 V2 — split actions de groupe en 3 boutons dédiés (clarté
          immédiate de l'intention). */}
      {isAdmin && view === "week" && bulkSelectMode && bulkSelectedIds.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-20 inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-gray-950 text-white shadow-[0_8px_24px_-4px_rgba(15,23,42,0.45)]">
          <span className="text-[12px] font-medium tabular-nums mr-1">
            {bulkSelectedIds.size} sélectionnée{bulkSelectedIds.size > 1 ? "s" : ""}
          </span>
          <Button
            type="button"
            variant="primary"
            size="sm"
            icon={UserCheck}
            onClick={() => setBulkAction("reassign")}
          >
            Réassigner
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            icon={CalendarDays}
            onClick={() => setBulkAction("shift")}
          >
            Décaler
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            icon={CheckCircle}
            onClick={() => setBulkAction("publish")}
          >
            Marquer publié
          </Button>
          <Button
            type="button"
            variant="danger"
            size="sm"
            icon={Ban}
            onClick={() => setBulkAction("cancel")}
          >
            Annuler
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setBulkSelectedIds(new Set());
              setBulkSelectMode(false);
            }}
            className="text-white hover:bg-white/10 ml-1"
          >
            Fermer
          </Button>
        </div>
      )}

      {bulkAction === "reassign" && (
        <BulkReassignModal
          slotIds={[...bulkSelectedIds]}
          monteurs={monteurs}
          cms={cms}
          videastes={videastes}
          onPatched={() => {
            setBulkSelectedIds(new Set());
            setBulkSelectMode(false);
            void load();
          }}
          onClose={() => setBulkAction(null)}
        />
      )}

      {bulkAction === "shift" && (
        <BulkShiftDateModal
          slotIds={[...bulkSelectedIds]}
          onPatched={() => {
            setBulkSelectedIds(new Set());
            setBulkSelectMode(false);
            void load();
          }}
          onClose={() => setBulkAction(null)}
        />
      )}

      {bulkAction === "publish" && (
        <BulkMarkPublishedModal
          slotIds={[...bulkSelectedIds]}
          eligibleCount={bulkPublishableCount}
          onPatched={() => {
            setBulkSelectedIds(new Set());
            setBulkSelectMode(false);
            void load();
          }}
          onClose={() => setBulkAction(null)}
        />
      )}

      {bulkAction === "cancel" && (
        <BulkCancelModal
          slotIds={[...bulkSelectedIds]}
          onPatched={() => {
            setBulkSelectedIds(new Set());
            setBulkSelectMode(false);
            void load();
          }}
          onClose={() => setBulkAction(null)}
        />
      )}

      <ConfirmDialog
        open={confirmGenOpen}
        title="Générer les publications de la semaine ?"
        description={
          genPreviewLoading
            ? `Analyse de la semaine du ${numericDateFr(weekStart)}…`
            : genPreview
              ? `Semaine du ${numericDateFr(weekStart)} — ${genPreview.created} slot${genPreview.created !== 1 ? "s" : ""} à créer, ${genPreview.skipped} déjà présent${genPreview.skipped !== 1 ? "s" : ""} (ignoré${genPreview.skipped !== 1 ? "s" : ""}).`
              : `Générer les slots auto pour la semaine du ${numericDateFr(weekStart)} ? Les slots existants ne seront pas écrasés.`
        }
        confirmLabel={genPreview && genPreview.created > 0 ? `Créer ${genPreview.created} slot${genPreview.created !== 1 ? "s" : ""}` : "Générer"}
        loading={generating}
        onConfirm={() => {
          void handleGenerateConfirmed();
        }}
        onCancel={() => {
          setConfirmGenOpen(false);
          setGenPreview(null);
        }}
      />
    </div>
  );
}

// ─── DayCard ────────────────────────────────────────────────────────────────

interface DayCardProps {
  day: Date;
  label: string;
  isToday: boolean;
  slots: PublicationSlot[];
  isAdmin: boolean;
  /** Drag-drop actif (ADMIN, hors mode multi-select). */
  dragEnabled: boolean;
  currentUserRole: UserRole;
  currentUserId: string;
  /** Sprint C — mode multi-select global au CalendarView. */
  bulkSelectMode: boolean;
  bulkSelectedIds: Set<string>;
  onSlotClick: (slot: PublicationSlot) => void;
  onSlotOpenDrawer: (slot: PublicationSlot) => void;
  onAddSlot: () => void;
}

function DayCard({
  day,
  label,
  isToday,
  slots,
  isAdmin,
  dragEnabled,
  currentUserRole,
  currentUserId,
  bulkSelectMode,
  bulkSelectedIds,
  onSlotClick,
  onSlotOpenDrawer,
  onAddSlot,
}: DayCardProps) {
  // Cible de drop = la colonne-jour entière. Désactivée quand le DnD est off
  // (non-admin ou mode multi-select) pour ne pas afficher de feedback inutile.
  const { setNodeRef, isOver } = useDayDrop(day.toISOString().slice(0, 10), {
    disabled: !dragEnabled,
  });
  // Colonne transparente : pas de fond glass, juste un header date et les
  // SlotCards qui portent toute la matière visuelle. Plus aéré, plus lisible.
  return (
    <section className="group/day relative flex flex-col">
      {/* I.1 — Header day single-line compact */}
      <header className="flex items-center gap-1.5 pb-1.5">
        <span
          className={`text-[12px] font-semibold tabular-nums ${
            isToday ? "text-primary" : "text-foreground"
          }`}
        >
          {label} {day.getDate()}
        </span>
        {isToday && (
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
        )}
      </header>

      {/* Liste de slots — gap compact (I.1) ; droppable pour le drag inter-jours.
          Quick-create (Phase 3) : un clic sur la zone vide (= le conteneur
          lui-même, pas une SlotCard ni le bouton) ouvre AddSlotModal pré-rempli. */}
      <div
        ref={setNodeRef}
        onClick={
          isAdmin && !bulkSelectMode
            ? (e) => {
                if (e.target === e.currentTarget) onAddSlot();
              }
            : undefined
        }
        className={[
          "flex-1 flex flex-col gap-1.5 min-h-[80px] rounded-lg transition-colors",
          isAdmin && !bulkSelectMode ? "cursor-pointer" : "",
          isOver ? "ring-2 ring-primary/40 bg-primary/5" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {slots.map((slot) => {
          const isSelected = bulkSelectedIds.has(slot.id);
          return (
            <DraggableSlot
              key={slot.id}
              slot={slot}
              dragEnabled={dragEnabled}
              bulkSelectMode={bulkSelectMode}
              isSelected={isSelected}
              onClick={() => onSlotClick(slot)}
              onOpenDrawer={
                isAdmin && !bulkSelectMode ? () => onSlotOpenDrawer(slot) : undefined
              }
              currentUserRole={currentUserRole}
              currentUserId={currentUserId}
            />
          );
        })}

        {/* Bouton "Ajouter" discret — visible si pas de slot ou au hover de la colonne */}
        {isAdmin && (
          <button
            type="button"
            onClick={onAddSlot}
            className={[
              "w-full inline-flex items-center justify-center gap-1 py-2 rounded-lg text-[11px] text-muted-foreground hover:text-info-700 hover:bg-white/70 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-info-200",
              slots.length === 0
                ? "opacity-70"
                : "opacity-0 group-hover/day:opacity-100",
            ].join(" ")}
            title="Ajouter une publication ce jour"
          >
            <Plus size={11} />
            <span>Ajouter</span>
          </button>
        )}
      </div>
    </section>
  );
}

// ─── DraggableSlot ────────────────────────────────────────────────────────────

interface DraggableSlotProps {
  slot: PublicationSlot;
  dragEnabled: boolean;
  bulkSelectMode: boolean;
  isSelected: boolean;
  onClick: () => void;
  onOpenDrawer?: () => void;
  currentUserRole: UserRole;
  currentUserId: string;
}

function DraggableSlot({
  slot,
  dragEnabled,
  bulkSelectMode,
  isSelected,
  onClick,
  onOpenDrawer,
  currentUserRole,
  currentUserId,
}: DraggableSlotProps) {
  // On ne spread que `listeners` (drag pointeur) : poser `attributes` ajouterait
  // un second role=button/tabIndex sur le wrapper alors que la SlotCard interne
  // est déjà focusable → double tab-stop. Entrée/Espace ouvrent donc le slot
  // (comportement par défaut souhaité), le drag reste à la souris/au toucher.
  const { listeners, setNodeRef, isDragging } = useSlotDrag(slot, {
    disabled: !dragEnabled,
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      className={[
        "relative",
        dragEnabled ? "touch-none" : "",
        isDragging ? "opacity-40" : "",
        bulkSelectMode
          ? `rounded-2xl transition-shadow ${
              isSelected
                ? "shadow-[0_0_0_2px_rgba(56,148,200,0.7)]"
                : "shadow-[0_0_0_1px_rgba(15,23,42,0.05)]"
            }`
          : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <SlotCard
        slot={slot}
        onClick={onClick}
        onOpenDrawer={onOpenDrawer}
        currentUserRole={currentUserRole}
        currentUserId={currentUserId}
      />
      {bulkSelectMode && (
        <span
          className={`absolute top-1.5 right-1.5 inline-flex h-5 w-5 items-center justify-center rounded-md pointer-events-none ${
            isSelected
              ? "bg-info-600 text-white"
              : "bg-white/90 border border-gray-300"
          }`}
        >
          {isSelected ? <CheckSquare size={14} /> : null}
        </span>
      )}
    </div>
  );
}

function DayCardSkeleton() {
  return (
    <section className="flex flex-col">
      <div className="h-4 w-14 bg-muted rounded mb-1.5 animate-pulse" />
      <div className="space-y-1.5">
        <div className="h-14 bg-muted rounded-md animate-pulse" />
        <div className="h-14 bg-muted rounded-md animate-pulse" />
      </div>
    </section>
  );
}
