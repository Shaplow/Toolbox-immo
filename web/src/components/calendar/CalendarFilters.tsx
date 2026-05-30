"use client";

/**
 * CalendarFilters — barre de filtres glass du calendrier (Phase 2 refonte).
 *
 * Remplace les selects HTML natifs par les molécules Liquid Glass v2 :
 * - Chip toggleable pour "À moi"
 * - Combobox pour compte / statut / assignations (cmdk fuzzy search)
 *
 * Pas de FilterBar wrapper ici : le wrapper est porté par CalendarView pour
 * pouvoir inclure aussi les badges contextuels (compte actif, filtre KPI).
 */

import { Chip } from "@/components/ui/Chip";
import { Combobox } from "@/components/ui/Combobox";
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

  const accountOptions = [
    { value: "", label: "Tous les comptes" },
    ...accounts.map((a) => ({
      value: a.id,
      label: `@${a.handle}`,
      keywords: [a.name, a.handle],
    })),
  ];

  const statusOptions = [
    { value: "", label: "Tous les statuts" },
    ...STATUSES.map(([key, label]) => ({ value: key, label })),
  ];

  const videasteOptions = videastes && videastes.length > 0
    ? [
        { value: "", label: "Tous les vidéastes" },
        ...videastes.map((v) => ({ value: v.id, label: v.label })),
      ]
    : null;

  const monteurOptions = monteurs && monteurs.length > 0
    ? [
        { value: "", label: "Tous les monteurs" },
        ...monteurs.map((m) => ({ value: m.id, label: m.label })),
      ]
    : null;

  const cmOptions = cms && cms.length > 0
    ? [
        { value: "", label: "Tous les CM" },
        ...cms.map((c) => ({ value: c.id, label: c.label })),
      ]
    : null;

  return (
    <div className="flex items-center gap-2 flex-wrap min-w-0">
      {hasMineToggle && (
        <Chip
          variant="sky"
          selected={filters.onlyMine}
          onClick={() => set("onlyMine", !filters.onlyMine)}
        >
          À moi
        </Chip>
      )}

      <div className="w-[180px]">
        <Combobox
          value={filters.accountId}
          onChange={(v) => set("accountId", v)}
          options={accountOptions}
          placeholder="Tous les comptes"
          emptyMessage="Aucun compte"
        />
      </div>

      <div className="w-[170px]">
        <Combobox
          value={filters.status}
          onChange={(v) => set("status", v)}
          options={statusOptions}
          placeholder="Tous les statuts"
          emptyMessage="Aucun statut"
        />
      </div>

      {videasteOptions && (
        <div className="w-[160px]">
          <Combobox
            value={filters.videasteId}
            onChange={(v) => set("videasteId", v)}
            options={videasteOptions}
            placeholder="Vidéastes"
            emptyMessage="Aucun vidéaste"
          />
        </div>
      )}

      {monteurOptions && (
        <div className="w-[160px]">
          <Combobox
            value={filters.monteurId}
            onChange={(v) => set("monteurId", v)}
            options={monteurOptions}
            placeholder="Monteurs"
            emptyMessage="Aucun monteur"
          />
        </div>
      )}

      {cmOptions && (
        <div className="w-[150px]">
          <Combobox
            value={filters.cmId}
            onChange={(v) => set("cmId", v)}
            options={cmOptions}
            placeholder="CM"
            emptyMessage="Aucun CM"
          />
        </div>
      )}
    </div>
  );
}
