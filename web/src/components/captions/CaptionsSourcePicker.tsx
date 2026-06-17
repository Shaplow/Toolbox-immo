"use client";

/**
 * CaptionsSourcePicker — sélection de la source des sous-titres :
 * transcription existante ou upload de fichier .srt / .json.
 *
 * Phase F3-step3 du split de CaptionsGenerateForm (plan F3). Le bloc
 * était inline (~115 LOC) avec tabs + liste de transcriptions + drop
 * zone fichier. Les states restent dans le parent ; le composant rend
 * en fonction des props.
 *
 * Le handler de drop fichier .srt/.json est inline ici (pure fonction
 * de transformation File → Segments). Les setters sont propagés depuis
 * le parent pour mettre à jour le state global du form.
 */

import { AlertCircle, FileText, Loader2, Mic, Upload } from "lucide-react";
import Link from "next/link";
import { parseSRT } from "@/lib/srt";
import type { Segment } from "@/lib/transcriptionProcess";
import type { Caption } from "@/lib/srt";
import { formatDate, srtTimeToSeconds } from "./utils";

type SourceTab = "transcription" | "upload";

interface TranscriptionItem {
  id: string;
  inputFilename: string | null;
  createdAt: string;
  status: string;
}

interface Props {
  sourceTab: SourceTab;
  setSourceTab: (t: SourceTab) => void;
  transcriptions: TranscriptionItem[];
  loadingTranscriptions: boolean;
  transcriptionLoadError: string | null;
  loadingSource: boolean;
  selectedTranscriptionId: string | null;
  setSelectedTranscriptionId: (id: string | null) => void;
  setSubsFile: (f: File | null) => void;
  setPendingSegments: (s: Segment[] | null) => void;
  setShowTrimEditor: (v: boolean) => void;
  setCaptions: (c: Caption[]) => void;
  setHighlighted: (h: Map<string, number>) => void;
  setTimedSegments: (s: Segment[] | null) => void;
  setTimingStatuses: (s: null) => void;
}

export function CaptionsSourcePicker({
  sourceTab,
  setSourceTab,
  transcriptions,
  loadingTranscriptions,
  transcriptionLoadError,
  loadingSource,
  selectedTranscriptionId,
  setSelectedTranscriptionId,
  setSubsFile,
  setPendingSegments,
  setShowTrimEditor,
  setCaptions,
  setHighlighted,
  setTimedSegments,
  setTimingStatuses,
}: Props) {
  return (
    <>
      {/* Tabs */}
      <div className="flex items-center gap-1 px-4 pt-3 pb-1">
        <button
          type="button"
          onClick={() => setSourceTab("transcription")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            sourceTab === "transcription" ? "bg-muted text-gray-900" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Mic size={12} /> Transcriptions
        </button>
        <button
          type="button"
          onClick={() => setSourceTab("upload")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            sourceTab === "upload" ? "bg-muted text-gray-900" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Upload size={12} /> Uploader un fichier
        </button>
      </div>

      <div className="px-4 py-3">
        {sourceTab === "transcription" ? (
          <>
            {transcriptionLoadError && (
              <p className="mb-2 text-xs text-red-500 flex items-center gap-1">
                <AlertCircle size={12} /> {transcriptionLoadError}
              </p>
            )}
            {loadingTranscriptions ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
                <Loader2 size={14} className="animate-spin" /> Chargement…
              </div>
            ) : transcriptions.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-4">
                Aucune transcription terminée.<br />
                <Link href="/transcriptions" className="text-info-600 hover:underline">
                  Lancer une transcription →
                </Link>
              </div>
            ) : (
              <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
                {transcriptions.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelectedTranscriptionId(t.id)}
                    disabled={loadingSource}
                    className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors text-sm border-border hover:border-danger-200 hover:bg-danger-50/60 text-foreground disabled:opacity-50"
                  >
                    {loadingSource && selectedTranscriptionId === t.id ? (
                      <Loader2 size={14} className="text-danger-200 animate-spin shrink-0" />
                    ) : (
                      <Mic size={14} className="text-muted-foreground/60 shrink-0" />
                    )}
                    <span className="flex-1 truncate">{t.inputFilename ?? "Transcription sans nom"}</span>
                    <span className="text-xs text-muted-foreground shrink-0">{formatDate(t.createdAt)}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <label className="flex flex-col items-center gap-2 p-6 border-2 border-dashed rounded-xl cursor-pointer transition-all border-border hover:border-border bg-white">
            <FileText size={24} className="text-muted-foreground/60" />
            <p className="text-sm font-medium text-muted-foreground">Glisser un fichier .srt ou .json</p>
            <p className="text-xs text-muted-foreground">ou cliquer pour parcourir</p>
            <input
              type="file"
              accept=".srt,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setSubsFile(f);
                if (f.name.endsWith(".json")) {
                  void f.text().then((txt) => {
                    try {
                      const segs = JSON.parse(txt) as Segment[];
                      setPendingSegments(segs);
                      setShowTrimEditor(true);
                      setCaptions([]);
                      setHighlighted(new Map());
                      setTimedSegments(null);
                      setTimingStatuses(null);
                    } catch {
                      // Silently ignore malformed JSON
                    }
                  });
                } else {
                  void f.text().then((txt) => {
                    const parsed = parseSRT(txt);
                    const segs: Segment[] = parsed.map((c) => ({
                      start: srtTimeToSeconds(c.start),
                      end: srtTimeToSeconds(c.end),
                      text: c.text,
                    }));
                    setPendingSegments(segs);
                    setShowTrimEditor(true);
                    setCaptions([]);
                    setHighlighted(new Map());
                    setTimedSegments(null);
                    setTimingStatuses(null);
                  });
                }
              }}
            />
          </label>
        )}
      </div>
    </>
  );
}
