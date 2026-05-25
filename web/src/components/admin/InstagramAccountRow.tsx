"use client";

import { useState } from "react";
import { Instagram, RefreshCw, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

interface Cursor {
  libraryId: string;
  cursor: number;
  lastAdvancedAt: string | null;
  library: { id: string; name: string; setSequence: string };
}

export interface InstagramAccountData {
  id: string;
  name: string;
  handle: string;
  offre: string;
  createdAt: string;
  _count: { renders: number };
  cursors: Cursor[];
}

interface Offer {
  id: string;
  name: string;
}

interface InstagramAccountRowProps {
  account: InstagramAccountData;
  offers: Offer[];
  onUpdated: () => void;
}

export function InstagramAccountRow({ account, offers, onUpdated }: InstagramAccountRowProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleChangeOffre(offre: string) {
    const res = await fetch(`/api/admin/accounts/${account.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ offre }),
    });
    if (!res.ok) {
      const d = await res.json() as { error?: string };
      toast.error(d.error ?? "Erreur lors de la mise à jour de l'offre");
      return;
    }
    onUpdated();
  }

  async function handleResetCursors() {
    setResetting(true);
    const res = await fetch(`/api/admin/accounts/${account.id}/cursors/reset`, { method: "POST" });
    setResetting(false);
    if (!res.ok) {
      toast.error("Erreur lors du reset des curseurs");
      setResetDialogOpen(false);
      return;
    }
    toast.success("Curseurs remis à zéro");
    setResetDialogOpen(false);
    onUpdated();
  }

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
          <Instagram className="h-4 w-4 shrink-0 text-pink-500" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{account.name}</p>
            <p className="text-xs text-gray-500">
              @{account.handle} · {account._count.renders} render{account._count.renders !== 1 ? "s" : ""}
            </p>
          </div>
          <select
            value={account.offre}
            onChange={(e) => { void handleChangeOffre(e.target.value); }}
            className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            title="Changer l'offre"
          >
            {offers.map((o) => <option key={o.id} value={o.name}>{o.name}</option>)}
            {/* Affiche l'offre actuelle même si elle n'est plus dans la liste */}
            {!offers.some((o) => o.name === account.offre) && (
              <option value={account.offre}>{account.offre}</option>
            )}
          </select>
          <button
            onClick={() => setIsExpanded((v) => !v)}
            className="rounded p-1 text-gray-400 hover:text-gray-600"
            title="Voir les curseurs"
          >
            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          <button
            onClick={() => setResetDialogOpen(true)}
            className="rounded p-1 text-gray-400 hover:text-blue-600"
            title="Remettre les curseurs à zéro"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            onClick={() => setDeleteDialogOpen(true)}
            className="rounded p-1 text-gray-400 hover:text-red-600"
            title="Supprimer"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>

        {isExpanded && (
          <div className="border-t border-gray-100 bg-gray-50 px-4 py-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Curseurs de séquence
            </p>
            {account.cursors.length === 0 ? (
              <p className="text-xs text-gray-400">
                Aucune bibliothèque utilisée avec theme_sequence pour le moment.
              </p>
            ) : (
              <div className="space-y-1">
                {account.cursors.map((c) => {
                  let themes: string[] = [];
                  try { themes = JSON.parse(c.library.setSequence) as string[]; } catch { themes = []; }
                  const activeTheme = themes.length > 0 ? themes[c.cursor % themes.length] : "—";
                  return (
                    <div
                      key={c.libraryId}
                      className="flex items-center gap-3 rounded border border-gray-200 bg-white px-3 py-2 text-xs"
                    >
                      <span className="font-medium text-gray-700">{c.library.name}</span>
                      <span className="text-gray-400">→</span>
                      <span className="rounded bg-blue-50 px-1.5 py-0.5 font-mono text-blue-700">
                        {activeTheme} ({c.cursor}/{themes.length || "?"})
                      </span>
                      {c.lastAdvancedAt && (
                        <span className="ml-auto text-gray-400">
                          avancé {new Date(c.lastAdvancedAt).toLocaleDateString("fr-FR")}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={resetDialogOpen}
        title="Remettre les curseurs à zéro"
        description={`Remettre tous les curseurs de séquence de « ${account.name} » à zéro ? Cette action est irréversible.`}
        confirmLabel="Remettre à zéro"
        variant="danger"
        loading={resetting}
        onConfirm={handleResetCursors}
        onCancel={() => setResetDialogOpen(false)}
      />

      <ConfirmDialog
        open={deleteDialogOpen}
        title="Supprimer le compte"
        description={`Supprimer le compte « ${account.name} » ? Ses curseurs seront perdus.`}
        confirmLabel="Supprimer"
        variant="danger"
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteDialogOpen(false)}
      />
    </>
  );
}
