"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FileStack, Plus, Search, Settings2, List, CalendarClock } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import { Switch } from "@/components/ui/Switch";
import { entityTypeIcon } from "@/components/entities/entityTypeIcons";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table, type TableColumn } from "@/components/ui/Table";
import { Tabs } from "@/components/ui/Tabs";
import { toast } from "@/components/ui/Toast";
import { dateFr, shortDateTimeFr } from "@/lib/date/formatFr";
import { CreateEntityModal } from "@/components/entities/CreateEntityModal";
import { EntitiesBulkActionBar } from "@/components/entities/EntitiesBulkActionBar";
import { BulkReassignEntitiesModal } from "@/components/entities/BulkReassignEntitiesModal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EntityCalendar } from "@/components/entities/EntityCalendar";
import {
  ENTITY_STATUS_BADGE,
  ENTITY_STATUS_LABELS,
  ENTITY_VALIDATION_BADGE,
  ENTITY_VALIDATION_LABELS,
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
  /** Pour distinguer « les miennes » : un admin voit tout, sans savoir ce qui le concerne. */
  currentUserId: string;
  accounts: { id: string; name: string; handle: string }[];
  videastes: Option[];
  monteurs: Option[];
  cms: Option[];
}

export function FichesListClient({
  types,
  initialSelectedTypeId,
  isAdmin,
  currentUserId,
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
  const [onlyMine, setOnlyMine] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  // Sélection multiple — `Table` sait déjà le faire (selectable/selectedKeys),
  // personne ne s'en servait dans le repo.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(
    async (typeId: string, includeArchived: boolean) => {
    if (!typeId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/entities?typeId=${typeId}${includeArchived ? "&includeArchived=true" : ""}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { entities: EntitySummary[] };
      setEntities(data.entities);
    } catch {
      toast.error("Impossible de charger les fiches.");
    } finally {
      setLoading(false);
    }
    },
    [],
  );

  useEffect(() => {
    if (view === "list" && activeType) void load(activeType.id, showArchived);
  }, [activeType, view, load, showArchived]);

  /**
   * Applique une action au lot. Le serveur renvoie des résultats PARTIELS :
   * afficher uniquement le succès masquerait les fiches qui ont résisté —
   * typiquement celles qui portent encore des publications.
   */
  async function runBulk(
    action: "archive" | "unarchive" | "delete" | "reassign",
    assignees?: Record<string, string | null>,
  ) {
    setBulkBusy(true);
    try {
      const res = await fetch("/api/entities/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selectedIds], action, assignees }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        ok?: string[];
        failed?: { id: string; label: string; error: string }[];
      };
      if (!res.ok) {
        toast.error(data.error ?? "Échec de l'action groupée.");
        return;
      }
      const okCount = data.ok?.length ?? 0;
      if (okCount > 0) toast.success(`${okCount} fiche(s) mise(s) à jour.`);
      if (data.failed?.length) {
        toast.error(
          `${data.failed.length} fiche(s) non traitée(s) : ${data.failed
            .slice(0, 3)
            .map((f) => `${f.label} — ${f.error}`)
            .join(" · ")}${data.failed.length > 3 ? " …" : ""}`,
        );
      }
      setSelectedIds(new Set());
      setReassignOpen(false);
      setConfirmDelete(false);
      if (activeType) void load(activeType.id, showArchived);
    } catch {
      toast.error("Erreur réseau.");
    } finally {
      setBulkBusy(false);
    }
  }

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
        cell: (row) => (
          <span className="font-medium text-foreground inline-flex items-center gap-2">
            {row.label}
            {row.validationStatus && row.validationStatus !== "APPROVED" && (
              <span
                className={[
                  "text-[10px] rounded px-1.5 py-0.5 border",
                  ENTITY_VALIDATION_BADGE[row.validationStatus],
                ].join(" ")}
              >
                {ENTITY_VALIDATION_LABELS[row.validationStatus]}
              </span>
            )}
            {row.isArchived && (
              <span className="text-[10px] rounded px-1.5 py-0.5 border border-border bg-muted text-muted-foreground">
                Archivée
              </span>
            )}
          </span>
        ),
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
      // Pour un type à planning, la date planifiée est l'information
      // principale — et c'est elle qui explique qu'une fiche n'apparaisse pas
      // dans la vue Planning (semaine courante).
      cols.push({
        id: "scheduledAt",
        label: "Date",
        sortable: true,
        cell: (row) => (
          <span className="text-muted-foreground text-xs tabular-nums">
            {row.scheduledAt ? shortDateTimeFr(row.scheduledAt) : "Non planifiée"}
          </span>
        ),
      });
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
          {dateFr(row.updatedAt)}
        </span>
      ),
    });
    return cols;
  }, [activeType]);

  const typeNamePlural = activeType?.namePlural ?? activeType?.name ?? "Fiches";

  /**
   * « À moi » : assigné comme vidéaste, ou équipe par défaut de la fiche.
   *
   * Un admin voit toutes les fiches sans distinction — ses propres tournages y
   * sont noyés. Le calendrier sait déjà le dire pour les publications
   * (« X pour toi ») ; c'est le même geste, transposé aux fiches.
   */
  const isMine = useCallback(
    (e: EntitySummary) =>
      e.assigneeVideasteId === currentUserId ||
      e.defaultAssigneeMonteurId === currentUserId ||
      e.defaultAssigneeCmId === currentUserId,
    [currentUserId],
  );
  const mineCount = useMemo(() => entities.filter(isMine).length, [entities, isMine]);

  const filteredEntities = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = onlyMine ? entities.filter(isMine) : entities;
    if (!q) return base;
    return base.filter(
      (e) =>
        e.label.toLowerCase().includes(q) ||
        Object.values(e.fields).some((v) => v.toLowerCase().includes(q)),
    );
  }, [entities, search, onlyMine, isMine]);

  /** Aperçu des fiches visées — cinq suffisent à reconnaître une erreur de tri. */
  const selectedLabels = useMemo(() => {
    const labels = filteredEntities
      .filter((e) => selectedIds.has(e.id))
      .slice(0, 5)
      .map((e) => e.label);
    if (labels.length === 0) return "";
    const extra = selectedIds.size - labels.length;
    return `${labels.join(", ")}${extra > 0 ? ` et ${extra} autre(s)` : ""}.`;
  }, [filteredEntities, selectedIds]);

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
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="max-w-xs flex-1">
                    <Input
                      value={search}
                      onChange={setSearch}
                      placeholder={`Rechercher dans ${typeNamePlural.toLowerCase()}…`}
                      icon={Search}
                      aria-label="Rechercher une fiche"
                    />
                  </div>
                  {/* Rendu seulement s'il y a quelque chose à isoler : une puce
                      « Les miennes · 0 » ne ferait que poser une question. */}
                  {mineCount > 0 && (
                    <button
                      type="button"
                      aria-pressed={onlyMine}
                      onClick={() => setOnlyMine((v) => !v)}
                      className={`shrink-0 px-2.5 h-8 rounded-md text-[12px] border transition-colors ${
                        onlyMine
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-card text-muted-foreground border-border hover:bg-accent"
                      }`}
                    >
                      Les miennes <span className="tabular-nums opacity-80">· {mineCount}</span>
                    </button>
                  )}
                  <Switch
                    checked={showArchived}
                    onChange={setShowArchived}
                    label="Voir les archivées"
                    size="sm"
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
                  selectable={isAdmin}
                  selectedKeys={selectedIds}
                  onSelectionChange={setSelectedIds}
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
            if (view === "list") void load(activeType.id, showArchived);
          }}
          type={activeType}
          accounts={accounts}
          videastes={videastes}
          monteurs={monteurs}
          cms={cms}
        />
      )}

      {isAdmin && view === "list" && (
        <EntitiesBulkActionBar
          selectedCount={selectedIds.size}
          visibleCount={filteredEntities.length}
          allVisibleSelected={
            filteredEntities.length > 0 &&
            filteredEntities.every((e) => selectedIds.has(e.id))
          }
          // « Tout sélectionner » porte sur les lignes VISIBLES : sélectionner
          // en aveugle des fiches masquées par la recherche serait un piège.
          onToggleAll={(checked) =>
            setSelectedIds(checked ? new Set(filteredEntities.map((e) => e.id)) : new Set())
          }
          onArchive={() => void runBulk("archive")}
          onUnarchive={() => void runBulk("unarchive")}
          onReassign={() => setReassignOpen(true)}
          onDelete={() => setConfirmDelete(true)}
          onClear={() => setSelectedIds(new Set())}
          busy={bulkBusy}
        />
      )}

      {reassignOpen && (
        <BulkReassignEntitiesModal
          count={selectedIds.size}
          videastes={videastes}
          monteurs={monteurs}
          cms={cms}
          busy={bulkBusy}
          onApply={(assignees) => void runBulk("reassign", assignees)}
          onClose={() => setReassignOpen(false)}
        />
      )}

      <ConfirmDialog
        open={confirmDelete}
        title={`Supprimer ${selectedIds.size} fiche${selectedIds.size > 1 ? "s" : ""} ?`}
        description={`Action irréversible. Les fiches encore rattachées à des publications, à une commande en cours ou à d'autres fiches seront refusées et vous seront listées. ${selectedLabels}`}
        confirmLabel="Supprimer"
        variant="danger"
        loading={bulkBusy}
        onConfirm={() => void runBulk("delete")}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}
