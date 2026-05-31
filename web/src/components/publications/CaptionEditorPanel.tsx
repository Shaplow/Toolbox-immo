"use client";

/**
 * CaptionEditorPanel — éditeur SRT manuel pour le mode pattern
 * `needsCaptionsMode = "manual"` (V8.2.4).
 *
 * Éditeur volontairement simple par rapport à `components/captions/CaptionEditor`
 * (qui sert pour l'édition word-by-word avec highlights sur des captions déjà
 * générées par Whisper). Ici, l'admin écrit ses sous-titres à la main :
 * blocs ordonnés `{start, end, text}`, ajout/suppression/réorganisation, et
 * sauvegarde POST /api/captions/manual.
 *
 * Pas de burn-in vidéo : on stocke juste le SRT sur le slot. Le rendu reste
 * réservé au mode auto (preset + RunPod).
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Save, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { FormField } from "@/components/ui/FormField";
import { toast } from "@/components/ui/Toast";
import { parseSRT, type Caption } from "@/lib/srt";

interface Props {
  slotId: string;
  /** SRT existant (mode "manual" relance) ou null si premier écrit. */
  initialSrt: string | null;
  /** Slug retour fiche pour la nav après save. */
  returnHref: string;
}

interface Block {
  start: string; // "00:00:01,000"
  end: string;
  text: string;
}

function captionsToBlocks(captions: Caption[]): Block[] {
  // parseSRT renvoie start/end déjà au format SRT — pas de conversion à faire.
  return captions.map((c) => ({
    start: c.start,
    end: c.end,
    text: c.text,
  }));
}

function secondsToTimecode(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds - Math.floor(seconds)) * 1000);
  return (
    String(h).padStart(2, "0") +
    ":" +
    String(m).padStart(2, "0") +
    ":" +
    String(s).padStart(2, "0") +
    "," +
    String(ms).padStart(3, "0")
  );
}

function timecodeToSeconds(tc: string): number | null {
  // Format "HH:MM:SS,mmm" ou "HH:MM:SS.mmm" ou "MM:SS"
  const m = tc.match(/^(?:(\d+):)?(\d+):(\d+)[,.](\d+)$/);
  if (m) {
    const h = m[1] ? parseInt(m[1], 10) : 0;
    return h * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10) + parseInt(m[4], 10) / 1000;
  }
  const m2 = tc.match(/^(\d+):(\d+):(\d+)$/);
  if (m2) {
    return parseInt(m2[1], 10) * 3600 + parseInt(m2[2], 10) * 60 + parseInt(m2[3], 10);
  }
  return null;
}

function blocksToSrt(blocks: Block[]): string {
  return blocks
    .map((b, i) => `${i + 1}\n${b.start} --> ${b.end}\n${b.text.trim()}\n`)
    .join("\n");
}

function validateBlocks(blocks: Block[]): string | null {
  if (blocks.length === 0) return "Ajoute au moins un sous-titre.";
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (!b.text.trim()) return `Bloc ${i + 1} : le texte est vide.`;
    const s = timecodeToSeconds(b.start);
    const e = timecodeToSeconds(b.end);
    if (s === null) return `Bloc ${i + 1} : timecode de début invalide.`;
    if (e === null) return `Bloc ${i + 1} : timecode de fin invalide.`;
    if (e <= s) return `Bloc ${i + 1} : la fin doit être après le début.`;
  }
  return null;
}

export function CaptionEditorPanel({ slotId, initialSrt, returnHref }: Props) {
  const router = useRouter();
  const initialBlocks = useMemo<Block[]>(() => {
    if (!initialSrt?.trim()) {
      return [
        { start: "00:00:00,000", end: "00:00:03,000", text: "" },
      ];
    }
    try {
      const parsed = parseSRT(initialSrt);
      return parsed.length > 0
        ? captionsToBlocks(parsed)
        : [{ start: "00:00:00,000", end: "00:00:03,000", text: "" }];
    } catch {
      return [{ start: "00:00:00,000", end: "00:00:03,000", text: "" }];
    }
  }, [initialSrt]);

  const [blocks, setBlocks] = useState<Block[]>(initialBlocks);
  const [saving, setSaving] = useState(false);

  function updateBlock(idx: number, patch: Partial<Block>) {
    setBlocks((prev) => prev.map((b, i) => (i === idx ? { ...b, ...patch } : b)));
  }

  function addBlock() {
    setBlocks((prev) => {
      const last = prev[prev.length - 1];
      const lastEnd = last ? timecodeToSeconds(last.end) ?? 0 : 0;
      return [
        ...prev,
        {
          start: secondsToTimecode(lastEnd),
          end: secondsToTimecode(lastEnd + 3),
          text: "",
        },
      ];
    });
  }

  function removeBlock(idx: number) {
    setBlocks((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSave() {
    const err = validateBlocks(blocks);
    if (err) {
      toast.error(err);
      return;
    }

    setSaving(true);
    try {
      const srt = blocksToSrt(blocks);
      const res = await fetch("/api/captions/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotId, srtContent: srt }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        toast.error(data.error || "Échec de la sauvegarde.");
        return;
      }
      toast.success("Sous-titres enregistrés.");
      router.push(returnHref);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Button
          variant="ghost"
          size="sm"
          icon={ArrowLeft}
          onClick={() => router.push(returnHref)}
        >
          Retour fiche
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" icon={Plus} onClick={addBlock}>
            Ajouter un bloc
          </Button>
          <Button
            variant="primary"
            size="sm"
            icon={Save}
            loading={saving}
            onClick={handleSave}
          >
            Enregistrer
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {blocks.map((b, i) => (
          <div
            key={i}
            className="rounded-xl border border-white/50 bg-white/70 backdrop-blur-[6px] p-3 space-y-2 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)]"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] uppercase tracking-widest text-gray-500 font-semibold">
                Bloc {i + 1}
              </span>
              <Button
                variant="ghost"
                size="sm"
                icon={Trash2}
                onClick={() => removeBlock(i)}
                disabled={blocks.length === 1}
              >
                Supprimer
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <FormField label="Début (HH:MM:SS,ms)">
                <Input
                  value={b.start}
                  onChange={(v) => updateBlock(i, { start: v })}
                  placeholder="00:00:00,000"
                />
              </FormField>
              <FormField label="Fin (HH:MM:SS,ms)">
                <Input
                  value={b.end}
                  onChange={(v) => updateBlock(i, { end: v })}
                  placeholder="00:00:03,000"
                />
              </FormField>
            </div>
            <FormField label="Texte">
              <Textarea
                value={b.text}
                onChange={(v) => updateBlock(i, { text: v })}
                rows={2}
                placeholder="Le texte affiché à l'écran…"
              />
            </FormField>
          </div>
        ))}
      </div>
    </div>
  );
}
