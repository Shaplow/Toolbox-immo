"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Download, Copy, Trash2 } from "lucide-react";
import { toast } from "@/components/ui/Toast";

export function TemplateAdminActions({ id }: { id: string }) {
  const router = useRouter();
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

  async function handleExport() {
    setLoading("export");
    try {
      const res = await fetch(`/api/templates/${id}/export`);
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
      link.download = fileNameMatch?.[1] ?? "template.json";
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
    await fetch(`/api/templates/${id}/duplicate`, { method: "POST" });
    router.refresh();
    setLoading(null);
    setOpen(false);
  }

  async function handleDelete() {
    setLoading("delete");
    await fetch(`/api/templates/${id}`, { method: "DELETE" });
    router.refresh();
    setLoading(null);
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative" data-menu-open={open ? "true" : undefined}>
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); setConfirming(false); }}
        className="flex items-center justify-center w-8 h-7 rounded-lg border border-gray-200 text-gray-400 hover:text-gray-700 hover:border-gray-300 hover:bg-gray-50 transition-colors"
        title="Plus d'actions"
      >
        <MoreHorizontal size={14} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-44 bg-white border border-gray-200 rounded-xl shadow-lg z-20 py-1 text-sm">
          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={loading !== null}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-gray-600 hover:bg-gray-50 hover:text-gray-900 disabled:opacity-50 transition-colors"
          >
            <Download size={13} />
            {loading === "export" ? "Export…" : "Exporter"}
          </button>
          <button
            type="button"
            onClick={() => void handleDuplicate()}
            disabled={loading !== null}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-gray-600 hover:bg-gray-50 hover:text-gray-900 disabled:opacity-50 transition-colors"
          >
            <Copy size={13} />
            {loading === "duplicate" ? "…" : "Dupliquer"}
          </button>
          <div className="border-t border-gray-100 my-1" />
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
              <p className="text-xs text-gray-500">Confirmer la suppression ?</p>
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
                  className="flex-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 py-1 rounded-lg transition-colors"
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
