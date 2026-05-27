"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Instagram, Settings2 } from "lucide-react";
import { ToolPageHeader } from "@/components/layout/ToolPageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";

interface AccountItem {
  id: string;
  handle: string;
  name: string;
  activePatternCount: number;
  lastPublishedAt: string | null;
  client: { id: string; name: string } | null;
}

type PatternState = "all" | "active" | "none";

interface Props {
  accounts: AccountItem[];
}

const SELECT_CLASS =
  "text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300";

function formatLastPublished(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

export function AccountsListAdmin({ accounts }: Props) {
  const [search, setSearch] = useState("");
  const [clientFilter, setClientFilter] = useState<string>("");
  const [patternState, setPatternState] = useState<PatternState>("all");

  // Listes uniques pour les dropdowns
  const clientOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of accounts) {
      if (a.client) map.set(a.client.id, a.client.name);
    }
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "fr"));
  }, [accounts]);

  // Filtrage combiné
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return accounts.filter((a) => {
      if (q) {
        const hay = `${a.handle} ${a.name} ${a.client?.name ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (clientFilter && a.client?.id !== clientFilter) return false;
      if (patternState === "active" && a.activePatternCount === 0) return false;
      if (patternState === "none" && a.activePatternCount > 0) return false;
      return true;
    });
  }, [accounts, search, clientFilter, patternState]);

  const hasAnyFilter =
    Boolean(search.trim()) || Boolean(clientFilter) || patternState !== "all";

  function clearFilters() {
    setSearch("");
    setClientFilter("");
    setPatternState("all");
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <ToolPageHeader
        icon={Instagram}
        iconColor="rose"
        title="Comptes Instagram"
        subtitle={`${accounts.length} compte${accounts.length !== 1 ? "s" : ""} — vue de recherche transverse multi-clients`}
      />

      {/* Filtres */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <div className="max-w-xs flex-1 min-w-[220px]">
          <Input
            value={search}
            onChange={setSearch}
            placeholder="Rechercher par @handle, nom ou client…"
          />
        </div>

        <select
          value={clientFilter}
          onChange={(e) => setClientFilter(e.target.value)}
          className={SELECT_CLASS}
        >
          <option value="">Tous les clients</option>
          {clientOptions.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        <select
          value={patternState}
          onChange={(e) => setPatternState(e.target.value as PatternState)}
          className={SELECT_CLASS}
        >
          <option value="all">Tous patterns</option>
          <option value="active">Avec patterns actifs</option>
          <option value="none">Sans pattern</option>
        </select>

        {hasAnyFilter && (
          <button
            type="button"
            onClick={clearFilters}
            className="text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors px-2 py-1"
          >
            Réinitialiser
          </button>
        )}

        <span className="ml-auto text-xs text-gray-400">
          {filtered.length} résultat{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Instagram}
          title="Aucun compte trouvé"
          description={
            hasAnyFilter
              ? "Modifiez les filtres pour voir d'autres comptes."
              : "Aucun compte Instagram configuré pour le moment."
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">Compte</th>
                <th className="px-4 py-2.5 text-left font-medium">Client</th>
                <th className="px-4 py-2.5 text-right font-medium">Patterns actifs</th>
                <th className="px-4 py-2.5 text-right font-medium">Dernière publi</th>
                <th className="px-4 py-2.5 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((a) => (
                <tr key={a.id} className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <Instagram className="h-4 w-4 shrink-0 text-pink-500" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{a.name}</p>
                        <p className="text-xs text-gray-500">@{a.handle}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {a.client ? (
                      <Link
                        href={`/admin/clients/${a.client.id}?tab=accounts`}
                        className="text-sm text-indigo-700 hover:text-indigo-900 hover:underline"
                      >
                        {a.client.name}
                      </Link>
                    ) : (
                      <span className="text-sm italic text-gray-400">Sans client</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {a.activePatternCount > 0 ? (
                      <span className="text-sm font-semibold text-gray-800">
                        {a.activePatternCount}
                      </span>
                    ) : (
                      <span
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200"
                        title="Aucun pattern actif — ce compte ne génère pas de slots"
                      >
                        Sans pattern
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-gray-500">
                    {formatLastPublished(a.lastPublishedAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/accounts/${a.id}`}
                      className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100 transition-colors"
                    >
                      <Settings2 className="h-3.5 w-3.5" />
                      Configurer
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
