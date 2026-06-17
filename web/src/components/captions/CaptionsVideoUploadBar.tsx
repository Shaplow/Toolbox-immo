"use client";

/**
 * CaptionsVideoUploadBar — barre horizontale compact pour uploader la vidéo
 * source des sous-titres.
 *
 * Phase F3-step6 du split de CaptionsGenerateForm (plan F3). Petit
 * composant pur (~35 LOC inline) extrait pour cohérence avec les autres
 * blocs (SourcePicker, AIPanel, JobQueue).
 *
 * État : "vide" (border gris, hover indigo) ou "rempli" (border violet,
 * affiche le filename + bouton X pour reset). Le label HTML englobe le
 * input file caché pour click n'importe où sur la zone.
 */

import { Upload, X } from "lucide-react";

interface Props {
  videoFile: File | null;
  setVideoFile: (file: File | null) => void;
}

export function CaptionsVideoUploadBar({ videoFile, setVideoFile }: Props) {
  return (
    <label
      className={`flex items-center gap-3 p-4 border rounded-2xl cursor-pointer transition-all mb-3 ${
        videoFile
          ? "border-danger-200 bg-danger-50"
          : "border-border bg-white hover:border-border"
      }`}
    >
      <div className={`w-9 h-9 rounded-xl flex shrink-0 items-center justify-center ${videoFile ? "bg-danger-100" : "bg-muted"}`}>
        <Upload size={15} className={videoFile ? "text-danger-600" : "text-muted-foreground"} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800">Vidéo</p>
        {videoFile ? (
          <p className="text-xs text-danger-600 mt-0.5 truncate">{videoFile.name}</p>
        ) : (
          <p className="text-xs text-muted-foreground mt-0.5">MP4 · MOV · WEBM</p>
        )}
      </div>
      {videoFile && (
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); setVideoFile(null); }}
          className="shrink-0 p-1.5 rounded-lg text-muted-foreground hover:bg-muted hover:text-muted-foreground transition-colors"
        >
          <X size={14} />
        </button>
      )}
      <input
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => setVideoFile(e.target.files?.[0] ?? null)}
      />
    </label>
  );
}
