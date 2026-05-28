"use client";

import { STATUS_LABELS, type SlotStatus } from "@/types/calendar";

interface Account {
  id: string;
  name: string;
  handle: string;
}

interface AssigneeOption {
  id: string;
  label: string;
}

export interface CalendarFiltersState {
  accountId: string;
  status: string;
  monteurId: string;
  cmId: string;
  videasteId: string;
  /** Vue "uniquement les slots dont l'action attend moi" — filtré client-side. */
  onlyMine: boolean;
}

interface CalendarFiltersProps {
  accounts: Account[];
  filters: CalendarFiltersState;
  onChange: (filters: CalendarFiltersState) => void;
  /** Liste des monteurs disponibles (ADMIN uniquement). */
  monteurs?: AssigneeOption[];
  /** Liste des CM disponibles (ADMIN uniquement). */
  cms?: AssigneeOption[];
  /** Liste des vidéastes disponibles (ADMIN uniquement). */
  videastes?: AssigneeOption[];
  /** True si l'utilisateur connecté a un rôle pipeline (sinon on cache "À moi"). */
  hasMineToggle?: boolean;
}

const STATUSES = Object.entries(STATUS_LABELS) as [SlotStatus, string][];

const SELECT_CLASS =
  "text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300";

export function CalendarFilters({
  accounts,
  filters,
  onChange,
  monteurs,
  cms,
  videastes,
  hasMineToggle,
}: CalendarFiltersProps) {
  function set<K extends keyof CalendarFiltersState>(key: K, value: CalendarFiltersState[K]) {
    onChange({ ...filters, [key]: value });
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Toggle "À moi" — pipeline roles uniquement */}
      {hasMineToggle && (
        <button
          type="button"
          onClick={() => set("onlyMine", !filters.onlyMine)}
          className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${
            filters.onlyMine
              ? "bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700"
              : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
          }`}
          aria-pressed={filters.onlyMine}
          title="N'afficher que les slots dont l'action attend moi"
        >
          {filters.onlyMine ? "✓ À moi" : "À moi"}
        </button>
      )}

      {/* Account filter */}
      <select
        value={filters.accountId}
        onChange={(e) => set("accountId", e.target.value)}
        className={SELECT_CLASS}
        aria-label="Filtrer par compte Instagram"
      >
        <option value="">Tous les comptes</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            @{a.handle} — {a.name}
          </option>
        ))}
      </select>

      {/* Status filter */}
      <select
        value={filters.status}
        onChange={(e) => set("status", e.target.value)}
        className={SELECT_CLASS}
        aria-label="Filtrer par statut"
      >
        <option value="">Tous les statuts</option>
        {STATUSES.map(([key, label]) => (
          <option key={key} value={key}>{label}</option>
        ))}
      </select>

      {/* Videaste filter (ADMIN only) */}
      {videastes && videastes.length > 0 && (
        <select
          value={filters.videasteId}
          onChange={(e) => set("videasteId", e.target.value)}
          className={SELECT_CLASS}
          aria-label="Filtrer par vidéaste"
        >
          <option value="">Tous les vidéastes</option>
          {videastes.map((v) => (
            <option key={v.id} value={v.id}>{v.label}</option>
          ))}
        </select>
      )}

      {/* Monteur filter (ADMIN only) */}
      {monteurs && monteurs.length > 0 && (
        <select
          value={filters.monteurId}
          onChange={(e) => set("monteurId", e.target.value)}
          className={SELECT_CLASS}
          aria-label="Filtrer par monteur"
        >
          <option value="">Tous les monteurs</option>
          {monteurs.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      )}

      {/* CM filter (ADMIN only) */}
      {cms && cms.length > 0 && (
        <select
          value={filters.cmId}
          onChange={(e) => set("cmId", e.target.value)}
          className={SELECT_CLASS}
          aria-label="Filtrer par CM"
        >
          <option value="">Tous les CM</option>
          {cms.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>
      )}
    </div>
  );
}
