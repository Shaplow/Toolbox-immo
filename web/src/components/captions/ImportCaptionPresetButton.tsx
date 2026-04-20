"use client";

import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { toast } from "@/components/ui/Toast";

export function ImportCaptionPresetButton({
  onImported,
}: {
  onImported?: () => void | Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setLoading(true);
    try {
      const text = await file.text();
      const payload = JSON.parse(text) as unknown;
      const res = await fetch("/api/caption-presets/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload }),
      });
      const data = await res.json().catch(() => null) as { error?: string } | null;
      if (!res.ok) {
        throw new Error(data?.error ?? "Import impossible");
      }

      toast.success("Preset importe");
      await onImported?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Import impossible");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json,.caption-preset.json"
        className="hidden"
        onChange={(event) => {
          void handleFileChange(event);
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={loading}
        className="flex items-center gap-1.5 text-sm border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-60"
      >
        <Upload size={14} />
        {loading ? "Import..." : "Importer"}
      </button>
    </>
  );
}