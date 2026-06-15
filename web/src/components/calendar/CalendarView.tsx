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
  PackagePlus,
  CheckSquare,
  Square,
  UserCheck,
  Ban,
} from "lucide-react";
import { DAY_LABELS, type PublicationSlot } from "@/types/calendar";
import { resolveSlotOwner } from "@/lib/slots/statusLabels";
import type { UserRole } from "@/types/roles";
import { SlotCard } from "./SlotCard";
import { SlotDetailPanel, type SlotDetailPanelMode } from "./SlotDetailPanel";
import { AddSlotModal } from "./AddSlotModal";
import { BulkStockModal } from "./BulkStockModal";
import { BankView } from "./BankView";
import { BulkReassignModal } from "./BulkReassignModal";
import { BulkShiftDateModal } from "./BulkShiftDateModal";
import { BulkCancelModal } from "./BulkCancelModal";
import { ScheduleFromBankModal } from "./ScheduleFromBankModal";
import { CalendarFilters, type CalendarFiltersState } from "./CalendarFilters";
import { toast } from "@/components/ui/Toast";
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
  const [showBulkStock, setShowBulkStock] = useState(false);
  const [scheduleFromBank, setScheduleFromBank] = useState<PublicationSlot | null>(null);
  const [addDefaultDate, setAddDefaultDate] = useState<string | undefined>(undefined);
  // Sprint C — multi-select calendrier admin pour bulk-patch
  // (réassigner monteur/CM/vidéaste, déplacer date, annuler).
  const [bulkSelectMode, setBulkSelectMode] = useState(false);
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<string>>(
    () => new Set(),
  );
  // Phase 7 V2 — split BulkPatchModal en 3 actions focalisées.
  const [bulkAction, setBulkAction] = useState<
    "reassign" | "shift" | "cancel" | null
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
      slot.status === "ARCHIVED" ||
      slot.status === "REJECTED";
    switch (kpiFilter) {
      case "overdue":
        return (
          !isTerminal &&
          slot.scheduledAt != null &&
          new Date(slot.scheduledAt).getTime() < now
        );
      case "no-pattern":
        return !slot.patternId;
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

  function slotsForDay(day: Date) {
    return visibleSlots
      .filter((s) => s.scheduledAt != null && isSameDay(new Date(s.scheduledAt), day))
      .sort(
        (a, b) =>
          new Date(a.scheduledAt as string).getTime() -
          new Date(b.scheduledAt as string).getTime(),
      );
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
    toast.success("Slot créé");
  }

  const weekLabel = `${weekStart.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
  })} – ${addDays(weekStart, 6).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })}`;

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
    <div className="min-h-screen">
      <div
        className="my-11 ml-[60px] mr-[100px] rounded-3xl min-h-[calc(100vh-5.5rem)] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06),0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.10)]"
        style={{
          background:
            "var(--gradient-page-shell)",
        }}
      >
        {/* Header de page — style Control Center (eyebrow + h1 BIG + live pill) */}
        <div className="rounded-t-3xl overflow-hidden">
          <div className="max-w-7xl mx-auto px-6 sm:px-8 pt-6 pb-2">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500">
                  Planning
                </p>
                <h1 className="mt-2 text-[36px] sm:text-[44px] font-semibold tracking-tight text-gray-950 leading-[1.05]">
                  {view === "bank" ? "Banque" : "Calendrier"}
                </h1>
                <p className="mt-2 text-[13px] text-gray-500">
                  {view === "bank" ? (
                    <>
                      {visibleSlots.length} contenu{visibleSlots.length > 1 ? "s" : ""}{" "}
                      en banque, en attente d&apos;une date de publication
                    </>
                  ) : (
                    <>
                      {visibleSlots.length} publication{visibleSlots.length > 1 ? "s" : ""}{" "}
                      {filters.onlyMine ? "à toi" : "cette semaine"}
                      {mineCount > 0 &&
                        !filters.onlyMine &&
                        currentUserRole !== "EXTERNAL_GENERATOR" && (
                          <>
                            {" · "}
                            <button
                              type="button"
                              onClick={() =>
                                setFilters((f) => ({ ...f, onlyMine: true }))
                              }
                              className="text-sky-700 hover:underline tabular-nums"
                            >
                              {mineCount} pour toi
                            </button>
                          </>
                        )}
                    </>
                  )}
                </p>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Live pill — visible uniquement en vue calendrier */}
                {view === "week" && (
                  <div className="inline-flex items-center gap-2 px-3 py-2 rounded-full bg-white/55 backdrop-blur-[12px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)]">
                    {isCurrentWeek && (
                      <span className="inline-flex h-1.5 w-1.5 rounded-full bg-sage-500 shadow-[0_0_8px_rgba(111,162,128,0.6)] animate-pulse" />
                    )}
                    <span className="text-[11px] font-mono text-gray-700 tabular-nums">
                      {weekLabel}
                    </span>
                  </div>
                )}

                {isAdmin && view === "bank" && (
                  <Button
                    variant="primary"
                    size="sm"
                    icon={PackagePlus}
                    onClick={() => setShowBulkStock(true)}
                    title="Créer des missions sans date"
                  >
                    Nouvelles missions
                  </Button>
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
                    {/* Nouveau slot = action primaire fréquente (création
                        ponctuelle). Mise en avant à gauche du groupe. */}
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
                    {/* Générer = action récurrente hebdomadaire. Secondaire,
                        visuellement moins prégnante mais accessible. */}
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={Sparkles}
                      onClick={() => {
                        // Pré-charge le résumé dry-run avant d'ouvrir le confirm.
                        // Sans ça (avant W4.9), l'admin acceptait à l'aveugle et
                        // découvrait après-coup combien de slots étaient créés.
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
              </div>
            </div>
          </div>
        </div>

        {/* Inner content area — cards glass flottantes indépendantes */}
        <div className="pt-6 md:pt-8 pb-12 px-4 sm:px-6 md:px-8">
          <div className="max-w-7xl mx-auto space-y-6">
            {/* Tabs — Calendrier vs Backlog. Le badge sur "Banque" rend
                visible la pression du backlog depuis la vue Calendrier
                (sans devoir basculer). Vert si des contenus sont prêts. */}
            <div className="flex justify-center">
              <Tabs
                variant="glass"
                value={view}
                onChange={(v) => switchView(v as "week" | "bank")}
                items={[
                  { id: "week", label: "Calendrier", icon: CalendarIcon },
                  {
                    id: "bank",
                    label: "Banque",
                    icon: Inbox,
                    badge: backlogTotal > 0 ? (
                      <span
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold tabular-nums shadow-[inset_0_0_0_1px_rgba(15,23,42,0.06)] ${
                          backlogReadyCount > 0
                            ? "bg-sky-100 text-sky-800"
                            : "bg-gray-100 text-gray-700"
                        }`}
                        title={
                          backlogReadyCount > 0
                            ? `${backlogTotal} en banque · ${backlogReadyCount} prêt${backlogReadyCount > 1 ? "s" : ""} à programmer`
                            : `${backlogTotal} en banque`
                        }
                      >
                        {backlogReadyCount > 0 ? (
                          <>
                            {backlogTotal}
                            <span className="opacity-60">·</span>
                            <span className="text-sky-700">{backlogReadyCount}</span>
                          </>
                        ) : (
                          backlogTotal
                        )}
                      </span>
                    ) : undefined,
                  },
                ]}
              />
            </div>

            {/* Card glass — Navigation semaine + Filtres */}
            <div className="p-3 rounded-2xl bg-gradient-to-b from-white/75 to-white/55 backdrop-blur-[8px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08),0_2px_8px_-2px_rgba(15,23,42,0.06)]">
              <div className="flex items-center gap-3 flex-wrap">
                {/* Navigation semaine inline — masquée en vue banque (sans dates) */}
                {view === "week" && (
                  <>
                    <div className="inline-flex items-center gap-1">
                      <ButtonIcon
                        icon={ChevronLeft}
                        label="Semaine précédente (←)"
                        variant="ghost"
                        size="sm"
                        onClick={prevWeek}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={CalendarDays}
                        onClick={goToday}
                        title="Aujourd'hui (T)"
                        disabled={isCurrentWeek}
                      >
                        Aujourd&apos;hui
                      </Button>
                      <ButtonIcon
                        icon={ChevronRight}
                        label="Semaine suivante (→)"
                        variant="ghost"
                        size="sm"
                        onClick={nextWeek}
                      />
                    </div>
                    <span className="h-5 w-px bg-gray-200/70" aria-hidden />
                  </>
                )}
                {/* Séparateur (visible uniquement en mode week, déjà dans le block ci-dessus) */}
                {/* Conservé hors-block pour le reste : aucun séparateur supplémentaire ici. */}
                <span className="hidden" aria-hidden />

                {/* Toggle filtres avancés */}
                <Chip
                  variant={showFilters || activeFilterCount > 0 ? "sky" : "default"}
                  icon={Filter}
                  selected={showFilters}
                  onClick={() => setShowFilters((s) => !s)}
                >
                  Filtres
                  {activeFilterCount > 0 && (
                    <span className="ml-1 tabular-nums">·{activeFilterCount}</span>
                  )}
                </Chip>

                {/* Badge filtre compte actif */}
                {filteredAccount && (
                  <Chip
                    variant="sky"
                    onRemove={clearAccountFilter}
                  >
                    @{filteredAccount.handle}
                  </Chip>
                )}

                {/* Badge filtre KPI (depuis HomeAdmin) */}
                {kpiFilter && (
                  <Chip
                    variant="peach"
                    onRemove={() => router.replace("/calendar")}
                  >
                    {kpiFilter === "overdue" && "En retard"}
                    {kpiFilter === "no-pattern" && "Sans pattern"}
                    {kpiFilter === "no-monteur" && "Sans monteur"}
                    {kpiFilter === "no-videaste" && "Sans vidéaste"}
                    <span className="ml-1 tabular-nums opacity-70">{kpiFilteredCount}</span>
                  </Chip>
                )}

                <div className="ml-auto inline-flex items-center gap-1">
                  {activeFilterCount > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={X}
                      onClick={resetFilters}
                    >
                      Réinitialiser
                    </Button>
                  )}
                  <ButtonIcon
                    icon={RefreshCw}
                    label="Rafraîchir"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      void load();
                    }}
                    loading={loading}
                  />
                </div>
              </div>

              {/* Filtres dépliables */}
              {showFilters && (
                <div className="mt-3 pt-3 border-t border-white/40">
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
            </div>

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
              /* Grille 7 colonnes — colonnes transparentes, SlotCards portent la matière */
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7 gap-x-5 gap-y-6">
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
            )}
          </div>
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

      {/* Modal bulk-stock banque (admin only) */}
      {showBulkStock && isAdmin && (
        <BulkStockModal
          accounts={accounts}
          monteurs={monteurs}
          defaultAccountId={filters.accountId || undefined}
          onCreated={(count) => {
            // Maj optimiste du compteur banque : N slots créés en RUSHES_EXPECTED
            // → +N au total, pas de changement sur readyCount.
            setBacklogTotal((prev) => prev + count);
            // Bascule sur la vue banque pour voir les missions créées.
            switchView("bank");
            void load();
          }}
          onClose={() => setShowBulkStock(false)}
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
                scheduledSlot.status === "READY_FOR_CM" ||
                scheduledSlot.status === "CAPTIONS_PENDING");
            setBacklogTotal((prev) => Math.max(0, prev - 1));
            if (wasReady) {
              setBacklogReadyCount((prev) => Math.max(0, prev - 1));
            }
            setSlots((prev) => prev.filter((s) => s.id !== slotId));
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
            ? `Analyse de la semaine du ${weekStart.toLocaleDateString("fr-FR")}…`
            : genPreview
              ? `Semaine du ${weekStart.toLocaleDateString("fr-FR")} — ${genPreview.created} slot${genPreview.created !== 1 ? "s" : ""} à créer, ${genPreview.skipped} déjà présent${genPreview.skipped !== 1 ? "s" : ""} (ignoré${genPreview.skipped !== 1 ? "s" : ""}).`
              : `Générer les slots auto pour la semaine du ${weekStart.toLocaleDateString("fr-FR")} ? Les slots existants ne seront pas écrasés.`
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
  currentUserRole,
  currentUserId,
  bulkSelectMode,
  bulkSelectedIds,
  onSlotClick,
  onSlotOpenDrawer,
  onAddSlot,
}: DayCardProps) {
  // Colonne transparente : pas de fond glass, juste un header date et les
  // SlotCards qui portent toute la matière visuelle. Plus aéré, plus lisible.
  return (
    <section className="group/day relative flex flex-col">
      {/* Header day — date + dot today peach inline */}
      <header className="flex items-baseline gap-2 pb-2.5">
        <span className="text-[10px] uppercase tracking-widest font-medium text-gray-500">
          {label}
        </span>
        <span
          className={`text-[18px] font-semibold tabular-nums leading-none ${
            isToday ? "text-peach-700" : "text-gray-700"
          }`}
        >
          {day.getDate()}
        </span>
        {isToday && (
          <span
            className="inline-flex h-1.5 w-1.5 rounded-full bg-peach-500 shadow-[0_0_6px_rgba(245,158,107,0.5)]"
            aria-hidden
          />
        )}
      </header>

      {/* Liste de slots — espacée généreusement */}
      <div className="flex-1 flex flex-col gap-2.5 min-h-[80px]">
        {slots.map((slot) => {
          const isSelected = bulkSelectedIds.has(slot.id);
          return (
            <div
              key={slot.id}
              className={
                bulkSelectMode
                  ? `relative rounded-2xl transition-shadow ${
                      isSelected
                        ? "shadow-[0_0_0_2px_rgba(56,148,200,0.7)]"
                        : "shadow-[0_0_0_1px_rgba(15,23,42,0.05)]"
                    }`
                  : "relative"
              }
            >
              <SlotCard
                slot={slot}
                onClick={() => onSlotClick(slot)}
                onOpenDrawer={
                  isAdmin && !bulkSelectMode ? () => onSlotOpenDrawer(slot) : undefined
                }
                currentUserRole={currentUserRole}
                currentUserId={currentUserId}
              />
              {bulkSelectMode && (
                <span
                  className={`absolute top-1.5 right-1.5 inline-flex h-5 w-5 items-center justify-center rounded-md pointer-events-none ${
                    isSelected
                      ? "bg-sky-600 text-white"
                      : "bg-white/90 border border-gray-300"
                  }`}
                >
                  {isSelected ? <CheckSquare size={14} /> : null}
                </span>
              )}
            </div>
          );
        })}

        {/* Bouton "Ajouter" discret — visible si pas de slot ou au hover de la colonne */}
        {isAdmin && (
          <button
            type="button"
            onClick={onAddSlot}
            className={[
              "w-full inline-flex items-center justify-center gap-1 py-2 rounded-lg text-[11px] text-gray-400 hover:text-sky-700 hover:bg-white/70 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300",
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

function DayCardSkeleton() {
  return (
    <section className="rounded-2xl bg-gradient-to-b from-white/55 to-white/30 backdrop-blur-[8px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)] p-3">
      <div className="h-3 w-12 bg-gray-200/70 rounded mb-2 animate-pulse" />
      <div className="h-4 w-8 bg-gray-200/70 rounded mb-3 animate-pulse" />
      <div className="space-y-1.5">
        <div className="h-14 bg-white/40 rounded-lg animate-pulse" />
        <div className="h-14 bg-white/40 rounded-lg animate-pulse" />
      </div>
    </section>
  );
}
