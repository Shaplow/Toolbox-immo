"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FileStack, Plus, Search, Settings2, List, CalendarClock } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import { entityTypeIcon } from "@/components/entities/entityTypeIcons";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table, type TableColumn } from "@/components/ui/Table";
import { Tabs } from "@/components/ui/Tabs";
import { toast } from "@/components/ui/Toast";
import { CreateEntityModal } from "@/components/entities/CreateEntityModal";
import { EntityCalendar } from "@/components/entities/EntityCalendar";
import {
  ENTITY_STATUS_BADGE,
  ENTITY_STATUS_LABELS,
  type EntitySummary,
  type EntityTypeSummary,
} from "@/types/entities";

interface Option {
  id: string;
  name: string;
}

interface FichesListClientProps {
  types: EntityTypeSummary[];
  initialSelectedTypeId: string;
  isAdmin: boolean;
  accounts: { id: string; name: string; handle: string }[];
  videastes: Option[];
  monteurs: Option[];
  cms: Option[];
}

export function FichesListClient({
  types,
  initialSelectedTypeId,
  isAdmin,
  accounts,
  videastes,
  monteurs,
  cms,
}: FichesListClientProps) {
  const router = useRouter();
  const [activeTypeId, setActiveTypeId] = useState(initialSelectedTypeId);
  const activeType = types.find((t) => t.id === activeTypeId) ?? types[0] ?? null;

  const [view, setView] = useState<"list" | "planning">(
    activeType?.hasPlanning ? "planning" : "list",
  );
  const [entities, setEntities] = useState<EntitySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState("");

  const load = useCallback(async (typeId: string) => {
    if (!typeId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/entities?typeId=${typeId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { entities: EntitySummary[] };
      setEntities(data.entities);
    } catch {
      toast.error("Impossible de charger les fiches.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (view === "list" && activeType) void load(activeType.id);
  }, [activeType, view, load]);

  function selectType(typeId: string) {
    setActiveTypeId(typeId);
    const type = types.find((t) => t.id === typeId);
    setView(type?.hasPlanning ? "planning" : "list");
    router.replace(`/fiches?type=${typeId}`, { scroll: false });
  }

  const columns: TableColumn<EntitySummary>[] = useMemo(() => {
    const cols: TableColumn<EntitySummary>[] = [
      {
        id: "label",
        label: "Libellé",
        sortable: true,
        cell: (row) => <span className="font-medium text-foreground">{row.label}</span>,
      },
    ];
    if (activeType?.hasAccount) {
      cols.push({
        id: "account",
        label: "Compte",
        cell: (row) => (
          <span className="text-muted-foreground text-xs">
            {row.account ? `@${row.account.handle}` : "—"}
          </span>
        ),
      });
    }
    if (activeType?.hasPlanning) {
      cols.push({
        id: "status",
        label: "Statut",
        cell: (row) => {
          const status = row.status ?? "PLANNED";
          return (
            <span className={["text-[10px] rounded px-1.5 py-0.5 border", ENTITY_STATUS_BADGE[status]].join(" ")}>
              {ENTITY_STATUS_LABELS[status]}
            </span>
          );
        },
      });
    }
    cols.push({
      // Somme reels + missions — « Publications » couvre les deux (V3.2).
      id: "linked",
      label: "Publications",
      align: "center",
      cell: (row) => (
        <span className="text-muted-foreground text-xs">{row._count.slots + row._count.shootSlots}</span>
      ),
    });
    cols.push({
      id: "updatedAt",
      label: "Mis à jour",
      sortable: true,
      cell: (row) => (
        <span className="text-muted-foreground text-xs">
          {new Date(row.updatedAt).toLocaleDateString("fr-FR", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </span>
      ),
    });
    return cols;
  }, [activeType]);

  const typeNamePlural = activeType?.namePlural ?? activeType?.name ?? "Fiches";

  const filteredEntities = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entities;
    return entities.filter(
      (e) =>
        e.label.toLowerCase().includes(q) ||
        Object.values(e.fields).some((v) => v.toLowerCase().includes(q)),
    );
  }, [entities, search]);

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground leading-tight">Fiches</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Fiches de données et de planning référencées par les publications.
          </p>
        </div>
        {isAdmin && (
          <Link
            href="/admin/entity-types"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-card border border-input text-foreground hover:bg-muted text-[12px] font-medium transition-colors"
          >
            <Settings2 size={13} />
            Types de fiches
          </Link>
        )}
      </div>

      {types.length === 0 ? (
        <EmptyState
          icon={FileStack}
          title="Aucun type de fiche"
          description="Aucun type de fiche accessible pour votre rôle."
        />
      ) : (
        <>
          {/* Tabs par type */}
          <Tabs
            variant="line"
            value={activeType?.id ?? ""}
            onChange={selectType}
            items={types.map((t) => ({ id: t.id, label: t.namePlural ?? t.name, icon: entityTypeIcon(t.icon) }))}
            className="mb-4"
          />

          {activeType && (
            <>
              <div className="flex items-center justify-between gap-3 mb-4">
                {activeType.hasPlanning ? (
                  <Tabs
                    variant="pill"
                    size="sm"
                    value={view}
                    onChange={(v) => setView(v as "list" | "planning")}
                    items={[
                      { id: "planning", label: "Planning", icon: CalendarClock },
                      { id: "list", label: "Liste", icon: List },
                    ]}
                  />
                ) : (
                  <span />
                )}
                {isAdmin && view === "list" && (
                  <Button onClick={() => setCreateOpen(true)} size="sm">
                    <Plus size={14} className="mr-1.5" />
                    Nouvelle fiche
                  </Button>
                )}
              </div>

              {view === "list" && (
                <div className="mb-3 max-w-xs">
                  <Input
                    value={search}
                    onChange={setSearch}
                    placeholder={`Rechercher dans ${typeNamePlural.toLowerCase()}…`}
                    icon={Search}
                    aria-label="Rechercher une fiche"
                  />
                </div>
              )}

              {view === "planning" && activeType.hasPlanning ? (
                <EntityCalendar
                  type={activeType}
                  isAdmin={isAdmin}
                  accounts={accounts}
                  videastes={videastes}
                  monteurs={monteurs}
                  cms={cms}
                />
              ) : loading ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 rounded-md" />
                  ))}
                </div>
              ) : filteredEntities.length === 0 ? (
                <EmptyState
                  icon={FileStack}
                  title={
                    search.trim()
                      ? "Aucune fiche ne correspond à la recherche"
                      : `Aucune fiche « ${activeType.name} »`
                  }
                  description={
                    search.trim()
                      ? "Essaie un autre terme, ou efface la recherche."
                      : `Créez une fiche pour la réutiliser dans ${typeNamePlural.toLowerCase()}.`
                  }
                  cta={isAdmin && !search.trim() ? { label: "Créer une fiche", onClick: () => setCreateOpen(true) } : undefined}
                />
              ) : (
                <Table
                  columns={columns}
                  rows={filteredEntities}
                  rowKey={(r) => r.id}
                  onRowClick={(row) => router.push(`/fiches/${row.id}`)}
                />
              )}
            </>
          )}
        </>
      )}

      {isAdmin && activeType && createOpen && (
        <CreateEntityModal
          open={createOpen}
          onClose={() => {
            setCreateOpen(false);
            if (view === "list") void load(activeType.id);
          }}
          type={activeType}
          accounts={accounts}
          videastes={videastes}
          monteurs={monteurs}
          cms={cms}
        />
      )}
    </>
  );
}
