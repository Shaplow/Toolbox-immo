"use client";

import { useState } from "react";
import Link from "next/link";
import { Instagram, Trash2, Settings2 } from "lucide-react";
import { toast } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

export interface InstagramAccountData {
  id: string;
  name: string;
  handle: string;
  createdAt: string;
  _count: { renders: number };
}

interface InstagramAccountRowProps {
  account: InstagramAccountData;
  onUpdated: () => void;
}

export function InstagramAccountRow({ account, onUpdated }: InstagramAccountRowProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    const res = await fetch(`/api/admin/accounts/${account.id}`, { method: "DELETE" });
    setDeleting(false);
    if (!res.ok) {
      const d = await res.json() as { error?: string };
      toast.error(d.error ?? "Erreur lors de la suppression");
      setDeleteDialogOpen(false);
      return;
    }
    setDeleteDialogOpen(false);
    onUpdated();
  }

  return (
    <>
      <div>
        <div className="flex items-center gap-3 px-4 py-3">
          <Instagram className="h-4 w-4 shrink-0 text-danger-600" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{account.name}</p>
            <p className="text-xs text-muted-foreground">
              @{account.handle} · {account._count.renders} render{account._count.renders !== 1 ? "s" : ""}
            </p>
          </div>
          <Link
            href={`/admin/accounts/${account.id}`}
            className="inline-flex items-center gap-1 rounded-md border border-info-200 bg-info-50 px-2.5 py-1 text-xs font-medium text-info-700 hover:bg-info-100 transition-colors"
            title="Configurer les patterns de publication"
          >
            <Settings2 className="h-3.5 w-3.5" />
            Configurer
          </Link>
          <button
            onClick={() => setDeleteDialogOpen(true)}
            className="rounded p-1 text-muted-foreground hover:text-red-600"
            title="Supprimer"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={deleteDialogOpen}
        title="Supprimer le compte"
        description={`Supprimer le compte « ${account.name} » ? Cette action est irréversible.`}
        confirmLabel="Supprimer"
        variant="danger"
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteDialogOpen(false)}
      />
    </>
  );
}
