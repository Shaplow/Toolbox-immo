"use client";

/**
 * ListingFormVariantCard — card de variant de génération dans ListingForm.
 *
 * Phase F2-step3 du split de ListingForm. Le rendu d'une variante (polling
 * spinner / error message / done preview image+video + boutons download)
 * était inline (~75 LOC). Extrait en composant pur consommant juste
 * l'objet Variant.
 */

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
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-50 flex items-center justify-between">
        <p className="text-xs font-medium text-gray-700">Variante {v.num}</p>
        {v.status === "done" && (
          <a href={`/renders/${v.id}`} className="text-[10px] text-indigo-700 hover:underline">
            Voir en plein écran →
          </a>
        )}
      </div>

      {v.status === "polling" && (
        <div className="h-36 flex flex-col items-center justify-center gap-3 text-gray-400">
          <div className="w-7 h-7 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
          <div className="space-y-1 text-center px-4">
            <p className="text-xs">Génération en cours…</p>
            {v.statusDetail && <p className="text-[10px] text-gray-500">{v.statusDetail}</p>}
            {typeof v.progress === "number" && (
              <p className="text-[10px] text-gray-400">{Math.round(v.progress * 100)}%</p>
            )}
          </div>
        </div>
      )}

      {v.status === "error" && (
        <div className="flex flex-col items-center justify-center gap-2 text-red-400 p-4">
          <span className="text-2xl">⚠</span>
          <p className="text-xs text-center font-medium">Erreur de génération</p>
          {v.errorMsg && (
            <p className="text-[10px] text-red-500 text-center bg-red-50 rounded-lg p-2 w-full break-words">{v.errorMsg}</p>
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
              className="w-full rounded-lg border border-gray-100 shadow-sm"
              style={{ maxHeight: 220 }}
            />
          )}
          {/* Rendu image */}
          {!v.videoUrl && v.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={v.imageUrl}
              alt={`Variante ${v.num}`}
              className="w-full rounded-lg border border-gray-100 shadow-sm"
            />
          )}
          <div className="flex gap-1.5">
            {v.videoUrl && (
              <a
                href={v.videoUrl}
                download
                className="flex-1 text-center text-xs py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg"
              >
                ↓ MP4
              </a>
            )}
            {!v.videoUrl && v.imageUrl && (
              <a
                href={v.imageUrl}
                download
                className="flex-1 text-center text-xs py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50"
              >
                ↓ PNG
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
