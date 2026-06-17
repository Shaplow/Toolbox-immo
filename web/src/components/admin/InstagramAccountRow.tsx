"use client";

import { useState } from "react";
import Link from "next/link";
import { Instagram, RefreshCw, Trash2, ChevronDown, ChevronUp, Settings2 } from "lucide-react";
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
  createdAt: string;
  _count: { renders: number };
  cursors: Cursor[];
}

interface InstagramAccountRowProps {
  account: InstagramAccountData;
  onUpdated: () => void;
}

export function InstagramAccountRow({ account, onUpdated }: InstagramAccountRowProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
            onClick={() => setIsExpanded((v) => !v)}
            className="rounded p-1 text-muted-foreground hover:text-muted-foreground"
            title="Voir les curseurs"
          >
            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          <button
            onClick={() => setResetDialogOpen(true)}
            className="rounded p-1 text-muted-foreground hover:text-blue-600"
            title="Remettre les curseurs à zéro"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            onClick={() => setDeleteDialogOpen(true)}
            className="rounded p-1 text-muted-foreground hover:text-red-600"
            title="Supprimer"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>

        {isExpanded && (
          <div className="border-t border-border bg-muted px-4 py-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Curseurs de séquence
            </p>
            {account.cursors.length === 0 ? (
              <p className="text-xs text-muted-foreground">
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
                      className="flex items-center gap-3 rounded border border-border bg-white px-3 py-2 text-xs"
                    >
                      <span className="font-medium text-foreground">{c.library.name}</span>
                      <span className="text-muted-foreground">→</span>
                      <span className="rounded bg-blue-50 px-1.5 py-0.5 font-mono text-blue-700">
                        {activeTheme} ({c.cursor}/{themes.length || "?"})
                      </span>
                      {c.lastAdvancedAt && (
                        <span className="ml-auto text-muted-foreground">
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
