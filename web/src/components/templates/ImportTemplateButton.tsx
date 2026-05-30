"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";

export function ImportTemplateButton() {
  const router = useRouter();
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
      const res = await fetch("/api/templates/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error ?? "Import impossible");
      }

      toast.success("Template importé");
      router.refresh();
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
        accept="application/json,.json,.template.json"
        className="hidden"
        onChange={(event) => {
          void handleFileChange(event);
        }}
      />
      <Button
        variant="secondary"
        size="sm"
        icon={Upload}
        onClick={() => inputRef.current?.click()}
        loading={loading}
      >
        {loading ? "Import…" : "Importer"}
      </Button>
    </>
  );
}
