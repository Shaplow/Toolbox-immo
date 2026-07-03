"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { PageShell } from "@/components/ui/PageShell";
import { Table, type TableColumn } from "@/components/ui/Table";
import { toast } from "@/components/ui/Toast";

export interface BienListItem {
  id: string;
  label: string;
  fieldSchema: string[];
  updatedAt: string;
  slotCount: number;
}

interface BiensListClientProps {
  initialBiens: BienListItem[];
}

export function BiensListClient({ initialBiens }: BiensListClientProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => {
    if (!query.trim()) return initialBiens;
    const q = query.trim().toLowerCase();
    return initialBiens.filter((b) => b.label.toLowerCase().includes(q));
  }, [initialBiens, query]);

  async function handleCreate() {
    setCreating(true);
    try {
      const res = await fetch("/api/properties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: "Nouveau bien" }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        toast.error(data.error ?? "Erreur lors de la création");
        return;
      }
      const created = (await res.json()) as { id: string };
      router.push(`/biens/${created.id}`);
    } catch {
      toast.error("Erreur réseau");
    } finally {
      setCreating(false);
    }
  }

  const columns: TableColumn<BienListItem>[] = [
    {
      id: "label",
      label: "Nom du bien",
      sortable: true,
      cell: (row) => (
        <span className="font-medium text-foreground">{row.label}</span>
      ),
    },
    {
      id: "fieldSchema",
      label: "Champs",
      cell: (row) => (
        <span className="text-muted-foreground text-xs">
          {row.fieldSchema.length === 0
            ? "Aucun"
            : row.fieldSchema.slice(0, 3).join(", ") +
              (row.fieldSchema.length > 3 ? ` +${row.fieldSchema.length - 3}` : "")}
        </span>
      ),
    },
    {
      id: "slotCount",
      label: "Missions",
      align: "center",
      sortable: true,
      cell: (row) => (
        <span className="text-muted-foreground text-xs">{row.slotCount}</span>
      ),
    },
    {
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
    },
  ];

  return (
    <PageShell variant="wide">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground leading-tight">Biens</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Fiches de données partagées référencées par les missions.
          </p>
        </div>
        <Button onClick={handleCreate} disabled={creating} size="sm">
          <Plus size={14} className="mr-1.5" />
          Nouveau bien
        </Button>
      </div>

      {/* Search */}
      <div className="mb-4 max-w-xs">
        <Input
          placeholder="Rechercher un bien…"
          value={query}
          onChange={(value) => setQuery(value)}
        />
      </div>

      {/* Table or empty state */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="Aucun bien"
          description={
            query.trim()
              ? "Aucun résultat pour cette recherche."
              : "Créez un bien pour le réutiliser sur plusieurs missions."
          }
          cta={
            query.trim()
              ? undefined
              : { label: "Créer un bien", onClick: handleCreate }
          }
        />
      ) : (
        <Table
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          onRowClick={(row) => router.push(`/biens/${row.id}`)}
        />
      )}
    </PageShell>
  );
}
