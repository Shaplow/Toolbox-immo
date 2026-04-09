"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { toast } from "@/components/ui/Toast";

export function ExportTemplateButton({ id }: { id: string }) {
  const [loading, setLoading] = useState(false);

  async function handleExport() {
    setLoading(true);

    try {
      const res = await fetch(`/api/templates/${id}/export`);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Export impossible");
      }

      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const contentDisposition = res.headers.get("Content-Disposition");
      const fileNameMatch = contentDisposition?.match(/filename="?([^\"]+)"?/i);

      link.href = href;
      link.download = fileNameMatch?.[1] ?? "template.template.json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(href);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export impossible");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleExport}
      disabled={loading}
      className="w-full flex items-center justify-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 py-1.5 rounded-lg disabled:opacity-50 transition-colors"
    >
      <Download size={11} />
      {loading ? "Export…" : "Exporter"}
    </button>
  );
}