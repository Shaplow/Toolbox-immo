"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Plus, RefreshCw, Calendar, X, Sparkles } from "lucide-react";
import { DAY_LABELS, type PublicationSlot } from "@/types/calendar";
import { resolveSlotOwner } from "@/lib/slots/statusLabels";
import type { UserRole } from "@/types/roles";
import { SlotCard } from "./SlotCard";
import { SlotDetailPanel, type SlotDetailPanelMode } from "./SlotDetailPanel";
import { AddSlotModal } from "./AddSlotModal";
import { CalendarFilters, type CalendarFiltersState } from "./CalendarFilters";
import { toast } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Button } from "@/components/ui/Button";

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
  /**
   * Rôle de l'utilisateur. ADMIN dispose de toutes les actions (drag/edit/generate/add).
   * MONTEUR et CM consultent en lecture seule, filtrés sur leurs slots assignés.
   */
  currentUserRole: UserRole;
  /** ID effectif (impersonation-aware) — utilisé pour mettre en avant les slots "à moi". */
  currentUserId: string;
  /** Liste des monteurs (ADMIN uniquement) — vide pour MONTEUR/CM. */
  monteurs?: AssigneeOption[];
  /** Liste des CM (ADMIN uniquement) — vide pour MONTEUR/CM. */
  cms?: AssigneeOption[];
  /** Liste des vidéastes (ADMIN uniquement). */
  videastes?: AssigneeOption[];
}

const ROLE_DETAIL_MODE: Record<UserRole, SlotDetailPanelMode> = {
  ADMIN: "admin",
  MONTEUR: "monteur",
  CM: "cm",
  // VIDÉASTE : même mode restreint que MONTEUR (lecture + status/notes éditables)
  VIDEASTE: "monteur",
  EXTERNAL_GENERATOR: "cm",
};

/** Returns Monday of the week containing `date`. */
function getMondayOf(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun
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

export function CalendarView({
  accounts,
  initialWeekStart,
  currentUserRole,
  currentUserId,
  monteurs = [],
  cms = [],
  videastes = [],
}: CalendarViewProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialAccountId = searchParams?.get("accountId") ?? "";
  // Filtre métier passé depuis HomeAdmin KPI cards.
  const kpiFilter = searchParams?.get("filter") ?? "";
  const isAdmin = currentUserRole === "ADMIN";
  const detailMode = ROLE_DETAIL_MODE[currentUserRole];

  // Phase nav 2026-05-28 — restaure la semaine depuis l'URL si présente
  // (?week=YYYY-MM-DD) pour que le retour depuis une fiche /publications/[id]
  // ne reset pas systématiquement à la semaine courante.
  const initialWeek = (() => {
    const w = searchParams?.get("week");
    if (w && /^\d{4}-\d{2}-\d{2}$/.test(w)) {
      const parsed = new Date(`${w}T00:00:00`);
      if (!isNaN(parsed.getTime())) return parsed;
    }
    return new Date(initialWeekStart);
  })();
  const [weekStart, setWeekStart] = useState<Date>(initialWeek);
  const [slots, setSlots] = useState<PublicationSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<PublicationSlot | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addDefaultDate, setAddDefaultDate] = useState<string | undefined>(undefined);
  const [generating, setGenerating] = useState(false);
  const [confirmGenOpen, setConfirmGenOpen] = useState(false);
  const [filters, setFilters] = useState<CalendarFiltersState>({
    accountId: initialAccountId,
    status: "",
    monteurId: "",
    cmId: "",
    videasteId: "",
    onlyMine: false,
  });

  /** Compte actif correspondant au filtre accountId, pour afficher le badge. */
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
      const dateToEnd = new Date(dateTo);
      dateToEnd.setHours(23, 59, 59, 999);
      const params = new URLSearchParams({
        dateFrom: dateFrom.toISOString(),
        dateTo: dateToEnd.toISOString(),
        ...(filters.accountId ? { accountId: filters.accountId } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.monteurId ? { monteurId: filters.monteurId } : {}),
        ...(filters.cmId ? { cmId: filters.cmId } : {}),
        ...(filters.videasteId ? { videasteId: filters.videasteId } : {}),
      });
      const res = await fetch(`/api/calendar/slots?${params.toString()}`);
      if (!res.ok) throw new Error(`Erreur ${res.status}`);
      const data = await res.json() as { slots: PublicationSlot[]; hasMore: boolean };
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
  }, [weekStart, filters]);

  useEffect(() => { void load(); }, [load]);

  // Clear slots avant chaque navigation pour déclencher le skeleton — sans
  // ça, le contenu stale de la semaine précédente reste visible pendant
  // le fetch et donne l'illusion qu'on est sur la bonne semaine.
  // Persiste la semaine courante dans l'URL (?week=YYYY-MM-DD) pour que le
  // retour depuis une fiche tombe sur la bonne semaine et la position scroll
  // soit cohérente avec ce qu'on regardait.
  function persistWeek(week: Date) {
    const iso = week.toISOString().slice(0, 10); // YYYY-MM-DD
    const url = new URL(window.location.href);
    url.searchParams.set("week", iso);
    router.replace(url.pathname + url.search, { scroll: false });
  }
  function prevWeek() {
    setSlots([]);
    setWeekStart((d) => {
      const nw = addDays(d, -7);
      persistWeek(nw);
      return nw;
    });
  }
  function nextWeek() {
    setSlots([]);
    setWeekStart((d) => {
      const nw = addDays(d, 7);
      persistWeek(nw);
      return nw;
    });
  }
  function goToday() {
    setSlots([]);
    const nw = getMondayOf(new Date());
    setWeekStart(nw);
    // Pas de persistWeek ici — on retombe sur le défaut serveur, URL clean.
    const url = new URL(window.location.href);
    url.searchParams.delete("week");
    router.replace(url.pathname + url.search, { scroll: false });
  }

  /** True si le slot attend une action de currentUser (rôle owner + assignation matchante).
   *  Owner contextualisé via resolveSlotOwner — pour les statuts amont
   *  (PLANNED, TO_DO) avec un vidéaste assigné, le owner devient VIDEASTE
   *  au lieu de l'ADMIN par défaut de STATUS_OWNER. */
  function isSlotMine(slot: PublicationSlot): boolean {
    const owner = resolveSlotOwner(slot);
    if (!owner) return false;
    if (owner === "ADMIN") return currentUserRole === "ADMIN";
    if (owner === "VIDEASTE") return slot.assigneeVideasteId === currentUserId;
    if (owner === "MONTEUR") return slot.assigneeMonteurId === currentUserId;
    if (owner === "CM") return slot.assigneeCmId === currentUserId;
    return false;
  }

  // KPI filter venant de HomeAdmin (en plus de onlyMine). Appliqué côté client
  // — il n'y a pas d'index serveur pour ces critères, mais sur take=500
  // c'est négligeable.
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
        return !isTerminal && new Date(slot.scheduledAt).getTime() < now;
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

  const visibleSlots = (filters.onlyMine ? slots.filter(isSlotMine) : slots).filter(matchesKpiFilter);
  const mineCount = slots.filter(isSlotMine).length;
  const kpiFilteredCount = kpiFilter ? slots.filter(matchesKpiFilter).length : 0;

  function slotsForDay(day: Date) {
    return visibleSlots
      .filter((s) => isSameDay(new Date(s.scheduledAt), day))
      .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  }

  async function handleGenerateConfirmed() {
    setConfirmGenOpen(false);
    setGenerating(true);
    try {
      const res = await fetch("/api/calendar/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dateFrom: dateFrom.toISOString(),
          dateTo: addDays(weekStart, 6).toISOString(),
        }),
      });
      if (!res.ok) throw new Error("Erreur lors de la génération");
      const result = await res.json() as { created: number; skipped: number };
      toast.success(`${result.created} slot(s) créé(s), ${result.skipped} ignoré(s) (existaient déjà).`);
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setGenerating(false);
    }
  }

  function handleSlotUpdated(updated: PublicationSlot) {
    setSlots((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    // Ne re-sélectionne le slot mis à jour QUE si c'est celui actuellement
    // ouvert dans le panneau. Sans cette garde, le PATCH d'un slot dont la
    // réponse arrive après que l'user ait switché vers un autre slot fait
    // sauter le panneau vers l'ancien — comportement très désorientant.
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

  const weekLabel = `${weekStart.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })} – ${addDays(weekStart, 6).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}`;

  const today = new Date();

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100 bg-white flex-wrap">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={prevWeek}
            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            onClick={goToday}
            className="px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 flex items-center gap-1.5"
          >
            <Calendar size={13} /> Aujourd&apos;hui
          </button>
          <button
            type="button"
            onClick={nextWeek}
            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        <span className="text-sm font-medium text-gray-800">{weekLabel}</span>

        {/* Badge filtre compte actif (provenant de ?accountId=) */}
        {filteredAccount && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">
            @{filteredAccount.handle}
            <button
              type="button"
              onClick={clearAccountFilter}
              className="hover:text-indigo-900 transition-colors"
              title="Effacer le filtre compte"
            >
              <X size={11} />
            </button>
          </span>
        )}

        {/* Badge filtre KPI venant de HomeAdmin (?filter=) */}
        {kpiFilter && (
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200"
            title={`${kpiFilteredCount} slot${kpiFilteredCount > 1 ? "s" : ""} dans la semaine affichée`}
          >
            {kpiFilter === "overdue" && "En retard"}
            {kpiFilter === "no-pattern" && "Sans pattern"}
            {kpiFilter === "no-monteur" && "Sans monteur"}
            {kpiFilter === "no-videaste" && "Sans vidéaste"}
            <span className="text-[10px] tabular-nums opacity-70">{kpiFilteredCount}</span>
            <button
              type="button"
              onClick={() => router.replace("/calendar")}
              className="hover:text-amber-900 transition-colors"
              title="Effacer le filtre"
            >
              <X size={11} />
            </button>
          </span>
        )}

        <div className="ml-auto flex items-center gap-2 flex-wrap">
          {/* Compteur "à toi" — visible si l'utilisateur a un rôle pipeline */}
          {currentUserRole !== "EXTERNAL_GENERATOR" && mineCount > 0 && (
            <span className="text-xs text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-full px-2.5 py-1 font-medium tabular-nums">
              {mineCount} pour toi
            </span>
          )}

          <CalendarFilters
            accounts={accounts}
            filters={filters}
            onChange={setFilters}
            monteurs={monteurs}
            cms={cms}
            videastes={videastes}
            hasMineToggle={currentUserRole !== "EXTERNAL_GENERATOR"}
          />

          <button
            type="button"
            onClick={() => { void load(); }}
            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"
            title="Rafraîchir"
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          </button>

          {isAdmin && (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setConfirmGenOpen(true)}
                loading={generating}
                icon={Sparkles}
              >
                Générer la semaine
              </Button>

              <Button
                variant="primary"
                size="sm"
                onClick={() => { setAddDefaultDate(undefined); setShowAdd(true); }}
                icon={Plus}
              >
                Slot
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Error */}
      {loadError && (
        <div className="mx-6 mt-4 text-sm text-red-600 bg-red-50 rounded-lg px-4 py-2">
          {loadError}
        </div>
      )}

      {/* Calendar grid */}
      <div className="flex-1 overflow-auto px-4 py-4">
        {/* F4-polish — skeleton du calendrier pendant le chargement initial.
            Affiché uniquement quand loading=true ET slots.length === 0 pour
            éviter un flash de skeleton lors des refresh subséquents. */}
        {loading && slots.length === 0 ? (
          <div className="grid grid-cols-7 gap-2 min-w-[700px]" aria-label="Chargement du calendrier" aria-busy="true">
            {weekDays.map((_day, i) => (
              <div key={i} className="flex flex-col gap-2">
                <div className="text-center pb-2 border-b border-gray-200">
                  <div className="h-3 w-8 mx-auto bg-gray-100 rounded animate-pulse" />
                  <div className="h-5 w-6 mx-auto mt-1 bg-gray-100 rounded animate-pulse" />
                </div>
                <div className="flex flex-col gap-2">
                  {[0, 1].map((j) => (
                    <div key={j} className="h-16 bg-gray-100 rounded-lg animate-pulse" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
        <div className="grid grid-cols-7 gap-2 min-w-[700px]">
          {/* Day headers */}
          {weekDays.map((day, i) => {
            const isToday = isSameDay(day, today);
            const daySlots = slotsForDay(day);
            return (
              <div key={i} className="flex flex-col gap-2">
                {/* Header */}
                <div className={`text-center pb-2 border-b ${isToday ? "border-indigo-400" : "border-gray-200"}`}>
                  <p className={`text-xs font-medium ${isToday ? "text-indigo-600" : "text-gray-500"}`}>
                    {DAY_LABELS[i]}
                  </p>
                  <p className={`text-lg font-semibold ${isToday ? "text-indigo-700" : "text-gray-800"}`}>
                    {day.getDate()}
                  </p>
                  {daySlots.length > 0 && (
                    <p className="text-[10px] text-gray-400">{daySlots.length} slot{daySlots.length > 1 ? "s" : ""}</p>
                  )}
                </div>

                {/* Slots */}
                <div className="flex flex-col gap-2">
                  {daySlots.map((slot) => (
                    <SlotCard
                      key={slot.id}
                      slot={slot}
                      onClick={() => setSelectedSlot(slot)}
                      currentUserRole={currentUserRole}
                      currentUserId={currentUserId}
                    />
                  ))}

                  {/* Add button inline per day — ADMIN uniquement */}
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => {
                        setAddDefaultDate(day.toISOString().slice(0, 10));
                        setShowAdd(true);
                      }}
                      className="w-full text-center text-xs text-gray-300 hover:text-indigo-400 py-1.5 border border-dashed border-gray-200 hover:border-indigo-200 rounded-lg transition-colors"
                    >
                      <Plus size={12} className="inline" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        )}
      </div>

      {/* Slot detail panel — key={slot.id} force le remontage du panneau
          quand on bascule d'un slot à un autre. Sans ce key, le `form`
          state local (titre, statut, notes, overrides) conservait les
          valeurs du slot précédent puisque React ne remonte pas le
          composant si la prop change d'un objet truthy à un autre. */}
      {selectedSlot && (
        <SlotDetailPanel
          key={selectedSlot.id}
          slot={selectedSlot}
          onUpdated={handleSlotUpdated}
          onDeleted={handleSlotDeleted}
          onClose={() => setSelectedSlot(null)}
          mode={detailMode}
        />
      )}

      {/* Add slot modal */}
      {showAdd && (
        <AddSlotModal
          accounts={accounts}
          defaultDate={addDefaultDate}
          onCreated={handleSlotCreated}
          onClose={() => setShowAdd(false)}
        />
      )}

      {/* Confirm generate dialog */}
      <ConfirmDialog
        open={confirmGenOpen}
        title="Générer les slots de la semaine ?"
        description={`Générer les slots auto pour la semaine du ${weekStart.toLocaleDateString("fr-FR")} ? Les slots existants ne seront pas écrasés.`}
        confirmLabel="Générer"
        loading={generating}
        onConfirm={() => { void handleGenerateConfirmed(); }}
        onCancel={() => setConfirmGenOpen(false)}
      />
    </div>
  );
}
