"use client";

import { useState } from "react";
import Link from "next/link";
import { Instagram, Settings2, ChevronRight } from "lucide-react";
import { ToolPageHeader } from "@/components/layout/ToolPageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";

interface AccountItem {
  id: string;
  handle: string;
  name: string;
  activePatternCount: number;
  client: { id: string; name: string } | null;
}

interface ClientGroup {
  clientId: string | null;
  clientName: string;
  accounts: AccountItem[];
}

interface Props {
  accounts: AccountItem[];
}

export function AccountsListAdmin({ accounts }: Props) {
  const [search, setSearch] = useState("");

  const filtered = search.trim()
    ? accounts.filter(
        (a) =>
          a.handle.toLowerCase().includes(search.toLowerCase()) ||
          a.name.toLowerCase().includes(search.toLowerCase()) ||
          (a.client?.name ?? "").toLowerCase().includes(search.toLowerCase()),
      )
    : accounts;

  // Group by client
  const groups: ClientGroup[] = [];
  const groupMap = new Map<string, ClientGroup>();

  for (const account of filtered) {
    const key = account.client?.id ?? "__no_client__";
    if (!groupMap.has(key)) {
      const group: ClientGroup = {
        clientId: account.client?.id ?? null,
        clientName: account.client?.name ?? "Sans client",
        accounts: [],
      };
      groupMap.set(key, group);
      groups.push(group);
    }
    groupMap.get(key)!.accounts.push(account);
  }

  // Sort groups: clients with name first, then "Sans client"
  groups.sort((a, b) => {
    if (a.clientId === null) return 1;
    if (b.clientId === null) return -1;
    return a.clientName.localeCompare(b.clientName, "fr");
  });

  const totalClients = groups.filter((g) => g.clientId !== null).length;

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <ToolPageHeader
        icon={Instagram}
        iconColor="rose"
        title="Comptes Instagram"
        subtitle={`${accounts.length} compte${accounts.length !== 1 ? "s" : ""} répartis sur ${totalClients} client${totalClients !== 1 ? "s" : ""}`}
      />

      {/* Search bar — Phase 1.9 B3 : migré vers primitif Input */}
      <div className="mb-6 max-w-sm">
        <Input
          value={search}
          onChange={setSearch}
          placeholder="Rechercher par @handle, nom ou client…"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Instagram}
          title="Aucun compte trouvé"
          description={
            search
              ? "Modifiez votre recherche pour voir d'autres comptes."
              : "Aucun compte Instagram configuré pour le moment."
          }
        />
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <div key={group.clientId ?? "__no_client__"}>
              {/* Client header */}
              <div className="flex items-center gap-2 mb-2">
                {group.clientId ? (
                  <Link
                    href={`/admin/clients/${group.clientId}`}
                    className="text-sm font-semibold text-indigo-700 hover:text-indigo-900 flex items-center gap-1 transition-colors"
                  >
                    {group.clientName}
                    <ChevronRight size={14} />
                  </Link>
                ) : (
                  <span className="text-sm font-semibold text-gray-400 italic">
                    {group.clientName}
                  </span>
                )}
                <span className="text-xs text-gray-400">
                  ({group.accounts.length} compte{group.accounts.length !== 1 ? "s" : ""})
                </span>
              </div>

              {/* Accounts for this client */}
              <div className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
                {group.accounts.map((account) => (
                  <div key={account.id} className="flex items-center gap-3 px-4 py-3">
                    <Instagram className="h-4 w-4 shrink-0 text-pink-500" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900">{account.name}</p>
                      <p className="text-xs text-gray-500">@{account.handle}</p>
                    </div>

                    {/* Active patterns count */}
                    <span className="shrink-0 text-xs text-gray-400">
                      {account.activePatternCount} pattern{account.activePatternCount !== 1 ? "s" : ""}
                    </span>

                    {/* Configure link */}
                    <Link
                      href={`/admin/accounts/${account.id}`}
                      className="shrink-0 inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100 transition-colors"
                    >
                      <Settings2 className="h-3.5 w-3.5" />
                      Configurer
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
