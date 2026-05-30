"use client";

/**
 * ListingFormVariantCard — card de variant de génération dans ListingForm.
 *
 * Refonte Phase A.3 (2026-05-30) : passage en glass v2 Coastal Studio.
 * - Polling : bulle peach + spinner peach + texte stage / progress
 * - Done    : preview vidéo/image bordée glass + actions Voir / Télécharger
 * - Error   : carte rose v2 + message en cell glass
 */

import { Download, Maximize2, Loader2, AlertCircle } from "lucide-react";

export interface Variant {
  id: string;
  num: number;
  status: "polling" | "done" | "error";
  imageUrl?: string;
  videoUrl?: string;
  errorMsg?: string;
  stage?: string;
  statusDetail?: string;
  progress?: number | null;
}

interface Props {
  variant: Variant;
}

export function ListingFormVariantCard({ variant: v }: Props) {
  return (
    <div className="rounded-2xl bg-gradient-to-b from-white/85 to-white/55 backdrop-blur-[10px] backdrop-saturate-150 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06),0_2px_8px_-4px_rgba(15,23,42,0.06)] overflow-hidden">
      <div className="px-3 py-2 border-b border-white/40 flex items-center justify-between bg-white/30 backdrop-blur-[6px]">
        <p className="text-[11.5px] font-semibold text-gray-700">Variante {v.num}</p>
        {v.status === "done" && (
          <a
            href={`/renders/${v.id}`}
            className="inline-flex items-center gap-1 text-[10.5px] text-sky-700 hover:text-sky-900 font-medium transition-colors"
          >
            <Maximize2 size={10} />
            Voir
          </a>
        )}
      </div>

      {v.status === "polling" && (
        <div className="h-36 flex flex-col items-center justify-center gap-3 px-4">
          <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-peach-100/70 backdrop-blur-[6px] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_0_1px_rgba(221,140,90,0.22)]">
            <Loader2 size={16} className="text-peach-700 animate-spin" />
          </div>
          <div className="space-y-0.5 text-center">
            <p className="text-[11.5px] text-gray-700 font-medium">Génération en cours…</p>
            {v.statusDetail && <p className="text-[10.5px] text-gray-500">{v.statusDetail}</p>}
            {typeof v.progress === "number" && (
              <p className="text-[10.5px] text-peach-700 font-medium tabular-nums">
                {Math.round(v.progress * 100)}%
              </p>
            )}
          </div>
        </div>
      )}

      {v.status === "error" && (
        <div className="flex flex-col items-center justify-center gap-2 p-4">
          <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-rose-100/70 backdrop-blur-[6px] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_0_1px_rgba(201,113,133,0.32)]">
            <AlertCircle size={16} className="text-rose-700" />
          </div>
          <p className="text-[11.5px] text-rose-800 font-semibold">Erreur de génération</p>
          {v.errorMsg && (
            <p className="text-[10.5px] text-rose-700 text-center rounded-lg bg-rose-50/60 backdrop-blur-[6px] shadow-[inset_0_0_0_1px_rgba(201,113,133,0.22)] p-2 w-full break-words">
              {v.errorMsg}
            </p>
          )}
        </div>
      )}

      {v.status === "done" && (v.imageUrl || v.videoUrl) && (
        <div className="p-3 space-y-2">
          {/* Rendu vidéo */}
          {v.videoUrl && (
            <video
              src={v.videoUrl}
              controls
              className="w-full rounded-lg shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)]"
              style={{ maxHeight: 220 }}
            />
          )}
          {/* Rendu image */}
          {!v.videoUrl && v.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={v.imageUrl}
              alt={`Variante ${v.num}`}
              className="w-full rounded-lg shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)]"
            />
          )}
          <div className="flex gap-1.5">
            {v.videoUrl && (
              <a
                href={v.videoUrl}
                download
                className="flex-1 inline-flex items-center justify-center gap-1 text-[11px] font-semibold py-1.5 rounded-lg bg-gradient-to-b from-gray-800 to-gray-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_2px_4px_rgba(15,23,42,0.18)] text-white hover:from-gray-900 hover:to-gray-950 transition-all"
              >
                <Download size={11} />
                MP4
              </a>
            )}
            {!v.videoUrl && v.imageUrl && (
              <a
                href={v.imageUrl}
                download
                className="flex-1 inline-flex items-center justify-center gap-1 text-[11px] font-semibold py-1.5 rounded-lg bg-white/65 backdrop-blur-[8px] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_0_1px_rgba(15,23,42,0.08)] text-gray-700 hover:bg-white/85 hover:text-gray-950 transition-all"
              >
                <Download size={11} />
                PNG
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
