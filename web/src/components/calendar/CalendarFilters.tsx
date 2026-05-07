"use client";

import { CONTENT_TYPES, STATUS_LABELS, type SlotStatus } from "@/types/calendar";

interface Account {
  id: string;
  name: string;
  handle: string;
  offre: string;
}

export interface CalendarFiltersState {
  accountId: string;
  status: string;
  contentType: string;
}

interface CalendarFiltersProps {
  accounts: Account[];
  filters: CalendarFiltersState;
  onChange: (filters: CalendarFiltersState) => void;
}

const STATUSES = Object.entries(STATUS_LABELS) as [SlotStatus, string][];

export function CalendarFilters({ accounts, filters, onChange }: CalendarFiltersProps) {
  function set(key: keyof CalendarFiltersState, value: string) {
    onChange({ ...filters, [key]: value });
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Account filter */}
      <select
        value={filters.accountId}
        onChange={(e) => set("accountId", e.target.value)}
        className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
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
        className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
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
        className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
      >
        <option value="">Tous les types</option>
        {CONTENT_TYPES.map((ct) => (
          <option key={ct} value={ct}>{ct}</option>
        ))}
      </select>
    </div>
  );
}
