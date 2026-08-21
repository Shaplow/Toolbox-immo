"use client";

/**
 * Liste des bons de commande — role-aware.
 * Admin : toutes, filtre statut. Externe : les siennes + fiches à valider.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ClipboardList, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Select } from "@/components/ui/Select";
import { Table, type TableColumn } from "@/components/ui/Table";
import { toast } from "@/components/ui/Toast";
import { dateFr } from "@/lib/date/formatFr";
import {
  ORDER_STATUS_BADGE,
  ORDER_STATUS_LABELS,
  type OrderStatus,
  type OrderSummary,
} from "@/types/orders";

export interface PendingClientFiche {
  id: string;
  label: string;
  typeName: string;
  orderId: string | null;
}

interface CommandesListClientProps {
  orders: OrderSummary[];
  isAdmin: boolean;
  pendingFiches: PendingClientFiche[];
}

export function CommandesListClient({ orders, isAdmin, pendingFiches }: CommandesListClientProps) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState("");
  const [validatingId, setValidatingId] = useState<string | null>(null);

  const filtered = useMemo(
    () => (statusFilter ? orders.filter((o) => o.status === statusFilter) : orders),
    [orders, statusFilter],
  );

  async function validateFiche(ficheId: string, action: "approve" | "reject") {
    setValidatingId(ficheId);
    try {
      const res = await fetch(`/api/entities/${ficheId}/validation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? "Échec de la validation.");
        return;
      }
      toast.success(action === "approve" ? "Fiche validée." : "Fiche refusée.");
      router.refresh();
    } catch {
      toast.error("Erreur réseau.");
    } finally {
      setValidatingId(null);
    }
  }

  const columns: TableColumn<OrderSummary>[] = [
    {
      id: "template",
      label: "Commande",
      cell: (row) => <span className="font-medium text-foreground">{row.templateName}</span>,
    },
    ...(isAdmin
      ? [
          {
            id: "client",
            label: "Client",
            cell: (row: OrderSummary) => (
              <span className="text-muted-foreground text-xs">{row.client.name}</span>
            ),
          },
        ]
      : []),
    {
      id: "account",
      label: "Compte",
      cell: (row) => (
        <span className="text-muted-foreground text-xs">
          {row.account ? `@${row.account.handle}` : "—"}
        </span>
      ),
    },
    {
      id: "status",
      label: "Statut",
      cell: (row) => (
        <span
          className={["text-[10px] rounded px-1.5 py-0.5 border", ORDER_STATUS_BADGE[row.status]].join(" ")}
        >
          {ORDER_STATUS_LABELS[row.status]}
        </span>
      ),
    },
    {
      id: "content",
      label: "Contenu",
      cell: (row) => (
        <span className="text-muted-foreground text-xs">
          {row.entityCount} fiche{row.entityCount > 1 ? "s" : ""}
          {row.slotCount > 0 ? ` · ${row.slotCount} vidéo${row.slotCount > 1 ? "s" : ""}` : ""}
        </span>
      ),
    },
    {
      id: "createdAt",
      label: "Créée le",
      sortable: true,
      cell: (row) => <span className="text-muted-foreground text-xs">{dateFr(row.createdAt)}</span>,
    },
  ];

  return (
    <>
      <div className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground leading-tight">
            {isAdmin ? "Commandes" : "Mes commandes"}
          </h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {isAdmin
              ? "Bons de commande des agences — à valider avant production."
              : "Vos bons de commande et leur avancement."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <div className="w-40">
              <Select
                value={statusFilter}
                onChange={setStatusFilter}
                options={[
                  { value: "", label: "Tous statuts" },
                  ...(Object.keys(ORDER_STATUS_LABELS) as OrderStatus[]).map((st) => ({
                    value: st,
                    label: ORDER_STATUS_LABELS[st],
                  })),
                ]}
              />
            </div>
          )}
          <Link href="/commandes/new">
            <Button size="sm">
              <Plus size={14} className="mr-1.5" />
              Nouvelle commande
            </Button>
          </Link>
        </div>
      </div>

      {/* Fiches à valider (externe) — validation client, non bloquante. */}
      {pendingFiches.length > 0 && (
        <div className="mb-6 bg-card border border-info-200 rounded-lg p-4">
          <p className="text-[13px] font-medium text-foreground mb-2">
            À valider par votre agence
          </p>
          <ul className="space-y-2">
            {pendingFiches.map((f) => (
              <li key={f.id} className="flex items-center gap-3">
                <span className="text-[13px] text-foreground flex-1 min-w-0 truncate">
                  {f.label}
                  <span className="ml-2 text-[11px] text-muted-foreground">{f.typeName}</span>
                </span>
                <Button
                  size="sm"
                  onClick={() => void validateFiche(f.id, "approve")}
                  disabled={validatingId === f.id}
                >
                  Valider
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void validateFiche(f.id, "reject")}
                  disabled={validatingId === f.id}
                >
                  Refuser
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title={statusFilter ? "Aucune commande avec ce statut" : "Aucune commande"}
          description={
            isAdmin
              ? "Les commandes soumises par les agences apparaîtront ici."
              : "Passez votre première commande — l'équipe la valide puis produit vos vidéos."
          }
          cta={{ label: "Nouvelle commande", onClick: () => router.push("/commandes/new") }}
        />
      ) : (
        <Table
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          onRowClick={(row) => router.push(`/commandes/${row.id}`)}
        />
      )}
    </>
  );
}
