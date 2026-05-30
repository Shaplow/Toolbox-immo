"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import type { CanvasFormat } from "@/types/template";
import { CANVAS_FORMATS } from "@/types/template";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { FormField } from "@/components/ui/FormField";
import { Combobox } from "@/components/ui/Combobox";

export function NewTemplateButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("Nouveau template");
  const [client, setClient] = useState("");
  const [format, setFormat] = useState<CanvasFormat>("A3_LANDSCAPE");
  const [customWidth, setCustomWidth] = useState(1920);
  const [customHeight, setCustomHeight] = useState(1080);
  const [loading, setLoading] = useState(false);

  async function handleCreate() {
    setLoading(true);
    const res = await fetch("/api/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        client,
        format,
        width: format === "CUSTOM" ? customWidth : undefined,
        height: format === "CUSTOM" ? customHeight : undefined,
      }),
    });
    const data = await res.json();
    setLoading(false);
    setOpen(false);
    if (data.id) {
      router.push(`/templates/${data.id}/edit`);
    }
  }

  const formatOptions = Object.entries(CANVAS_FORMATS).map(([key, val]) => ({
    value: key,
    label: val.label,
  }));

  return (
    <>
      <Button variant="primary" size="sm" icon={Plus} onClick={() => setOpen(true)}>
        Nouveau template
      </Button>

      <Modal open={open} onClose={() => !loading && setOpen(false)} size="md">
        <Modal.Header onClose={() => !loading && setOpen(false)}>
          Nouveau template
        </Modal.Header>
        <Modal.Body>
          <div className="space-y-3">
            <FormField label="Nom" required>
              <Input value={name} onChange={setName} placeholder="Nouveau template" />
            </FormField>

            <FormField label="Client" help="Optionnel">
              <Input value={client} onChange={setClient} placeholder="ex: Bonjour Oscar" />
            </FormField>

            <FormField label="Format">
              <Combobox
                value={format}
                onChange={(v) => setFormat(v as CanvasFormat)}
                options={formatOptions}
              />
            </FormField>

            {format === "CUSTOM" && (
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Largeur (px)">
                  <Input
                    type="number"
                    value={String(customWidth)}
                    onChange={(v) => setCustomWidth(Math.max(1, Number(v) || 1))}
                  />
                </FormField>
                <FormField label="Hauteur (px)">
                  <Input
                    type="number"
                    value={String(customHeight)}
                    onChange={(v) => setCustomHeight(Math.max(1, Number(v) || 1))}
                  />
                </FormField>
              </div>
            )}
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={loading}>
            Annuler
          </Button>
          <Button
            variant="primary"
            icon={Plus}
            onClick={() => void handleCreate()}
            loading={loading}
            disabled={!name.trim()}
          >
            Créer
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
}
