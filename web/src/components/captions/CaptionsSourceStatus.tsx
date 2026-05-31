"use client";

/**
 * CaptionsSourceStatus — petite carte de status affichée sous le source
 * picker quand une source de sous-titres est sélectionnée.
 *
 * Phase F3-step9 du split de CaptionsGenerateForm. Regroupe les 3 états
 * de status (trim editor ouvert / captions chargées / subsFile chargé
 * sans trim) qui étaient inline (~45 LOC) avec des conditions imbriquées.
 *
 * Composant pur — pas de state.
 */

import { Check, FileText, Mic } from "lucide-react";

interface TranscriptionItem {
  id: string;
  inputFilename: string | null;
  createdAt: string;
  status: string;
}

interface Props {
  showTrimEditor: boolean;
  captionsCount: number;
  subsFile: File | null;
  selectedTranscriptionId: string | null;
  transcriptions: TranscriptionItem[];
  pendingSegmentsCount: number;
}

export function CaptionsSourceStatus({
  showTrimEditor,
  captionsCount,
  subsFile,
  selectedTranscriptionId,
  transcriptions,
  pendingSegmentsCount,
}: Props) {
  // Trim editor open — show source name as status
  if (showTrimEditor) {
    return (
      <div className="px-4 py-3 flex items-center gap-3">
        <div className="w-8 h-8 bg-rose-100 rounded-lg flex shrink-0 items-center justify-center">
          {selectedTranscriptionId ? <Mic size={14} className="text-rose-600" /> : <FileText size={14} className="text-rose-600" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-800">
            {selectedTranscriptionId
              ? (transcriptions.find((t) => t.id === selectedTranscriptionId)?.inputFilename ?? "Transcription")
              : (subsFile?.name ?? "Segments pré-chargés")}
          </p>
          <p className="text-xs text-gray-400">{pendingSegmentsCount} segments · édition en cours</p>
        </div>
      </div>
    );
  }

  // Captions ready — show summary
  if (captionsCount > 0) {
    return (
      <div className="px-4 py-3 flex items-center gap-3">
        <div className="w-8 h-8 bg-rose-100 rounded-lg flex shrink-0 items-center justify-center">
          <Check size={14} className="text-rose-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-800">{captionsCount} lignes</p>
          <p className="text-xs text-gray-400">
            {selectedTranscriptionId
              ? (transcriptions.find((t) => t.id === selectedTranscriptionId)?.inputFilename ?? "Transcription")
              : (subsFile?.name ?? "Sous-titres chargés")}
          </p>
        </div>
      </div>
    );
  }

  // subsFile loaded but not yet in trim editor (edge case: plain SRT without trim)
  if (subsFile) {
    return (
      <div className="px-4 py-3 flex items-center gap-3">
        <div className="w-8 h-8 bg-rose-100 rounded-lg flex shrink-0 items-center justify-center">
          <FileText size={14} className="text-rose-600" />
        </div>
        <p className="text-sm font-medium text-gray-800 truncate">{subsFile.name}</p>
      </div>
    );
  }

  return null;
}
