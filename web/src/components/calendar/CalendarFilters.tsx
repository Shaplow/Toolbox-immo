"use client";

import { CONTENT_TYPES, STATUS_LABELS, type SlotStatus } from "@/types/calendar";

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
  contentType: string;
  monteurId: string;
  cmId: string;
}

interface CalendarFiltersProps {
  accounts: Account[];
  filters: CalendarFiltersState;
  onChange: (filters: CalendarFiltersState) => void;
  /** Liste des monteurs disponibles (ADMIN uniquement). */
  monteurs?: AssigneeOption[];
  /** Liste des CM disponibles (ADMIN uniquement). */
  cms?: AssigneeOption[];
}

const STATUSES = Object.entries(STATUS_LABELS) as [SlotStatus, string][];

const SELECT_CLASS =
  "text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300";

export function CalendarFilters({ accounts, filters, onChange, monteurs, cms }: CalendarFiltersProps) {
  function set(key: keyof CalendarFiltersState, value: string) {
    onChange({ ...filters, [key]: value });
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Account filter */}
      <select
        value={filters.accountId}
        onChange={(e) => set("accountId", e.target.value)}
        className={SELECT_CLASS}
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
      >
        <option value="">Tous les statuts</option>
        {STATUSES.map(([key, label]) => (
          <option key={key} value={key}>{label}</option>
        ))}
      </select>

      {/* Content type filter */}
      <select
        value={filters.contentType}
        onChange={(e) => set("contentType", e.target.value)}
        className={SELECT_CLASS}
      >
        <option value="">Tous les types</option>
        {CONTENT_TYPES.map((ct) => (
          <option key={ct} value={ct}>{ct}</option>
        ))}
      </select>

      {/* Monteur filter (ADMIN only) */}
      {monteurs && monteurs.length > 0 && (
        <select
          value={filters.monteurId}
          onChange={(e) => set("monteurId", e.target.value)}
          className={SELECT_CLASS}
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
