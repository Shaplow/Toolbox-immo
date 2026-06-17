"use client";

import { useState, useRef, useEffect } from "react";
import { MoreHorizontal, Download, Copy, Trash2 } from "lucide-react";
import { toast } from "@/components/ui/Toast";

interface Props {
  id: string;
  onChanged: () => void | Promise<void>;
}

export function CaptionPresetActions({ id, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState<"export" | "duplicate" | "delete" | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setConfirming(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  async function handleDelete() {
    setLoading("delete");
    try {
      const res = await fetch(`/api/caption-presets/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => null) as { error?: string } | null;
      if (!res.ok) {
        throw new Error(data?.error ?? "Suppression impossible");
      }
      await onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Suppression impossible");
    } finally {
      setLoading(null);
      setOpen(false);
    }
  }

  async function handleExport() {
    setLoading("export");
    try {
      const res = await fetch(`/api/caption-presets/${id}/export`);
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(data?.error ?? "Export impossible");
      }
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const contentDisposition = res.headers.get("Content-Disposition");
      const fileNameMatch = contentDisposition?.match(/filename="?([^"]+)"?/i);
      link.href = href;
      link.download = fileNameMatch?.[1] ?? "preset-captions.json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(href);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export impossible");
    } finally {
      setLoading(null);
      setOpen(false);
    }
  }

  async function handleDuplicate() {
    setLoading("duplicate");
    try {
      const res = await fetch(`/api/caption-presets/${id}/duplicate`, { method: "POST" });
      const data = await res.json().catch(() => null) as { error?: string } | null;
      if (!res.ok) {
        throw new Error(data?.error ?? "Duplication impossible");
      }
      await onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Duplication impossible");
    } finally {
      setLoading(null);
      setOpen(false);
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); setConfirming(false); }}
        className="flex items-center justify-center w-8 h-7 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-border hover:bg-muted transition-colors"
        title="Plus d'actions"
      >
        <MoreHorizontal size={14} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-44 bg-white border border-border rounded-xl shadow-lg z-20 py-1 text-sm">
          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={loading !== null}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-muted-foreground hover:bg-muted hover:text-gray-900 disabled:opacity-50 transition-colors"
          >
            <Download size={13} />
            {loading === "export" ? "Export..." : "Exporter"}
          </button>
          <button
            type="button"
            onClick={() => void handleDuplicate()}
            disabled={loading !== null}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-muted-foreground hover:bg-muted hover:text-gray-900 disabled:opacity-50 transition-colors"
          >
            <Copy size={13} />
            {loading === "duplicate" ? "..." : "Dupliquer"}
          </button>
          <div className="border-t border-border my-1" />
          {!confirming ? (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={loading !== null}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-red-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 transition-colors"
            >
              <Trash2 size={13} />
              Supprimer
            </button>
          ) : (
            <div className="px-3 py-2 space-y-1.5">
              <p className="text-xs text-muted-foreground">Confirmer la suppression ?</p>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  disabled={loading !== null}
                  className="flex-1 text-xs bg-red-500 hover:bg-red-600 text-white py-1 rounded-lg disabled:opacity-50 transition-colors"
                >
                  {loading === "delete" ? "…" : "Supprimer"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="flex-1 text-xs bg-muted hover:bg-gray-200 text-muted-foreground py-1 rounded-lg transition-colors"
                >
                  Annuler
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
