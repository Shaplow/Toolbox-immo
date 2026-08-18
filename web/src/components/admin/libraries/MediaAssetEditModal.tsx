"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Scissors, X, Volume2, SlidersHorizontal } from "lucide-react";
import type { MediaEditParams, MediaEditJob } from "@/types/mediaEdit";
import { TrimPlayer } from "@/components/ui/molecules/TrimPlayer";
import { formatTimecode } from "@/lib/time";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { ButtonIcon } from "@/components/ui/ButtonIcon";
import { Switch } from "@/components/ui/Switch";
import { Slider } from "@/components/ui/Slider";
import { Chip } from "@/components/ui/Chip";
import { Badge } from "@/components/ui/Badge";
import { Alert } from "@/components/ui/Alert";

interface MediaAsset {
  id: string;
  filename: string;
  url: string;
  duration: number | null;
}

interface Props {
  asset: MediaAsset;
  onClose: () => void;
  onDone: (assetId: string) => void;
}

const POLL_INTERVAL_MS = 3000;
const GAIN_PRESETS = [-12, -6, -3, 0, 3, 6, 12];

export function MediaAssetEditModal({ asset, onClose, onDone }: Props) {
  // ── Duration ───────────────────────────────────────────────────────────────
  // Sourcée depuis TrimPlayer (métadonnées vidéo réelles) plutôt que
  // asset.duration (DB) — évite de figer un trimEnd sur une valeur périmée
  // si le probe d'upload a échoué ou si le fichier a été retrimé côté R2.
  const [duration, setDuration] = useState(asset.duration ?? 0);

  // ── Trim state ────────────────────────────────────────────────────────────
  const [trimStart, setTrimStart] = useState(0);
  // undefined tant que l'utilisateur n'a pas édité : laisse TrimPlayer caler
  // trimEnd sur la durée réelle de la vidéo au chargement des métadonnées.
  const [trimEnd, setTrimEnd] = useState<number | undefined>(undefined);

  // ── Audio ──────────────────────────────────────────────────────────────────
  const [mixToMono, setMixToMono] = useState(false);
  const [normalize, setNormalize] = useState(false);
  const [gainDb, setGainDb] = useState(0);

  // ── Job ────────────────────────────────────────────────────────────────────
  const [jobStatus, setJobStatus] = useState<"idle" | "submitting" | "processing" | "done" | "failed">("idle");
  const [jobError,  setJobError]  = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Polling ───────────────────────────────────────────────────────────────
  const pollJobStatusRef = useRef<(() => Promise<void>) | undefined>(undefined);

  const pollJobStatus = useCallback(async () => {
    try {
      const res  = await fetch(`/api/admin/libraries/media/assets/${asset.id}/edit`);
      if (!res.ok) return;
      const data = await res.json() as { job: MediaEditJob | null };
      if (!data.job) return;

      if (data.job.status === "done") {
        setJobStatus("done");
        onDone(asset.id);
      } else if (data.job.status === "failed") {
        setJobStatus("failed");
        setJobError(data.job.errorMsg ?? "Le traitement a échoué");
      } else {
        pollRef.current = setTimeout(() => { void pollJobStatusRef.current?.(); }, POLL_INTERVAL_MS);
      }
    } catch {
      pollRef.current = setTimeout(() => { void pollJobStatusRef.current?.(); }, POLL_INTERVAL_MS);
    }
  }, [asset.id, onDone]);

  useEffect(() => { pollJobStatusRef.current = pollJobStatus; });
  useEffect(() => () => { if (pollRef.current) clearTimeout(pollRef.current); }, []);

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    setJobStatus("submitting");
    setJobError(null);

    const params: MediaEditParams = {
      ...(trimStart > 0 && { trimStart }),
      ...(trimEnd !== undefined && trimEnd < duration && { trimEnd }),
      mixToMono,
      normalize,
      ...(gainDb !== 0 && { gainDb }),
    };

    try {
      const res  = await fetch(`/api/admin/libraries/media/assets/${asset.id}/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      const data = await res.json() as { jobId?: string; error?: string };

      if (res.status === 409) {
        // Another job is already running for this asset — switch to monitoring it.
        setJobStatus("processing");
        pollRef.current = setTimeout(() => { void pollJobStatusRef.current?.(); }, POLL_INTERVAL_MS);
        return;
      }
      if (!res.ok) {
        setJobStatus("failed");
        setJobError(data.error ?? `Erreur ${res.status}`);
        return;
      }

      setJobStatus("processing");
      pollRef.current = setTimeout(() => { void pollJobStatusRef.current?.(); }, POLL_INTERVAL_MS);
    } catch (err) {
      setJobStatus("failed");
      setJobError(String(err));
    }
  };

  // ── Derived ───────────────────────────────────────────────────────────────
  const trimChanged = trimStart > 0 || (trimEnd !== undefined && trimEnd < duration);
  const hasOps      = trimChanged || mixToMono || normalize || gainDb !== 0;
  const busy        = jobStatus === "submitting" || jobStatus === "processing";

  return (
    <Modal open onClose={onClose} size="lg" className="flex flex-col max-h-[92vh]">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 bg-danger-100 rounded-lg flex items-center justify-center shrink-0">
            <Scissors size={15} className="text-danger-700" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">Éditer le rush</h2>
            <p className="text-[11px] text-muted-foreground truncate max-w-[380px]">{asset.filename}</p>
          </div>
        </div>
        <ButtonIcon icon={X} label="Fermer" variant="ghost" size="sm" onClick={onClose} />
      </div>

      <div className="p-5 space-y-6 overflow-y-auto flex-1 min-h-0">
        {/* Découpe : vidéo + scrubber + timecodes éditables + nudge frame par frame,
            tout géré par la primitive partagée (play = prévisualiser la sélection). */}
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide flex items-center gap-1.5">
            <SlidersHorizontal size={12} className="text-muted-foreground" />
            Découpe
          </h3>
          <TrimPlayer
            src={asset.url}
            aspect="16:9"
            fps={25}
            start={trimStart}
            end={trimEnd}
            onChange={(s, e) => { setTrimStart(s); setTrimEnd(e); }}
            onDurationChange={setDuration}
          />
        </div>

        {/* Audio section */}
        <div className="space-y-4">
          <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide flex items-center gap-1.5">
            <Volume2 size={12} className="text-muted-foreground" /> Audio
          </h3>

          {/* Gain */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground font-medium">Volume</span>
              <Button variant="ghost" size="sm" onClick={() => setGainDb(0)} disabled={gainDb === 0}>
                reset
              </Button>
            </div>
            <Slider value={gainDb} onChange={setGainDb} min={-24} max={24} step={1} unit=" dB" editable />
            {/* Quick presets */}
            <div className="flex flex-wrap gap-1.5">
              {GAIN_PRESETS.map((v) => (
                <Chip key={v} size="sm" selected={gainDb === v} onClick={() => setGainDb(v)}>
                  {v > 0 ? `+${v}` : v}&nbsp;dB
                </Chip>
              ))}
            </div>
          </div>

          {/* Mix to mono + Normalize */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-border p-3">
              <Switch
                checked={mixToMono}
                onChange={setMixToMono}
                label="Mix mono"
                description="Fusionne L+R — utile si le micro est sur un seul canal."
              />
            </div>
            <div className="rounded-xl border border-border p-3">
              <Switch
                checked={normalize}
                onChange={setNormalize}
                label="Normaliser"
                description="loudnorm EBU R128 — I = −16 LUFS."
              />
            </div>
          </div>
        </div>

        {/* Destructive warning */}
        <Alert variant="warning">
          Cette opération est <strong>irréversible</strong>. Le fichier original sera écrasé.
        </Alert>

        {/* Error */}
        {jobError && <Alert variant="danger">{jobError}</Alert>}

        {/* Success */}
        {jobStatus === "done" && <Alert variant="success">Asset mis à jour avec succès.</Alert>}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-border shrink-0">
        {/* Operation summary */}
        <div className="flex flex-wrap gap-1">
          {trimChanged && (
            <Badge variant="danger">Découpe {formatTimecode(trimStart)} → {formatTimecode(trimEnd ?? duration)}</Badge>
          )}
          {gainDb !== 0 && (
            <Badge variant="danger">Volume {gainDb > 0 ? `+${gainDb}` : gainDb}&nbsp;dB</Badge>
          )}
          {mixToMono && <Badge variant="danger">Mix mono</Badge>}
          {normalize && <Badge variant="danger">Normalisation</Badge>}
          {!hasOps && (
            <span className="text-[11px] text-muted-foreground italic">Aucune opération sélectionnée</span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={onClose}>
            {jobStatus === "done" ? "Fermer" : "Annuler"}
          </Button>

          {jobStatus !== "done" && (
            <Button
              size="sm"
              icon={Scissors}
              loading={busy}
              disabled={!hasOps}
              onClick={() => void handleSubmit()}
            >
              {busy ? (jobStatus === "submitting" ? "Soumission…" : "Traitement…") : "Appliquer"}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
