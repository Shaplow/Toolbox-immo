"use client";

/**
 * DescriptionHistoryItem — row d'historique des descriptions générées.
 *
 * Phase F (Vague 4 polish) du split de DescriptionTool. Le composant
 * était inline (~85 LOC) dans DescriptionTool. Extrait pour réduire la
 * masse du composant orchestrateur.
 *
 * Inclut un excerpt inline (~120 chars) visible quand collapsed pour
 * donner un aperçu immédiat sans nécessiter l'expand (Vague 4 polish
 * livré dans commit `af6ba2b`).
 */

import { useState } from "react";
import { Check, ChevronDown, ChevronUp, Copy } from "lucide-react";
import type { DescriptionJobRow } from "./DescriptionTool";

interface Props {
  job: DescriptionJobRow;
}

export function DescriptionHistoryItem({ job }: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const isDone = job.status === "COMPLETED";
  const isFailed = job.status === "FAILED";
  // Cas wasApplied=false : COMPLETED + errorMsg explicite signalant que
  // le résultat n'a pas été écrit sur slot.description (CM a rédigé
  // pendant la génération). Le badge "Non appliquée" évite la friction
  // silencieuse identifiée dans l'audit F3.
  const notApplied = isDone && !!job.errorMsg;

  const handleCopy = () => {
    if (!job.result) return;
    void navigator.clipboard.writeText(job.result);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Preview inline du résultat (~120 premiers chars) — visible même quand
  // l'item est collapsed pour donner un aperçu immédiat sans avoir à cliquer.
  const excerpt = isDone && job.result
    ? job.result.length > 120 ? job.result.slice(0, 120).trim() + "…" : job.result
    : null;

  return (
    <div className="px-5 py-3">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex-1 text-left flex items-center gap-2 min-w-0"
        >
          <span className="text-sm font-medium text-foreground truncate">
            {job.inputFilename ?? "Sans nom"}
          </span>
          {job.prompt && (
            <span className="text-[10px] text-muted-foreground shrink-0">— {job.prompt.name}</span>
          )}
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${
              notApplied
                ? "bg-warning-50 text-warning-700"
                : isDone
                  ? "bg-green-50 text-green-600"
                  : isFailed
                    ? "bg-red-50 text-red-500"
                    : "bg-gray-100 text-muted-foreground"
            }`}
            title={notApplied ? (job.errorMsg ?? undefined) : undefined}
          >
            {notApplied ? "Non appliquée" : isDone ? "OK" : isFailed ? "Erreur" : job.status}
          </span>
        </button>
        <span className="text-[11px] text-muted-foreground shrink-0">
          {new Date(job.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
        </span>
        {isDone && job.result && (
          <button
            onClick={handleCopy}
            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
            title="Copier"
          >
            {copied ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
          </button>
        )}
        <button onClick={() => setOpen((v) => !v)} className="shrink-0 text-muted-foreground hover:text-muted-foreground">
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {/* Excerpt inline visible quand collapsed — donne un aperçu immédiat
          du résultat sans nécessiter l'expand. Click sur l'excerpt expand
          le détail complet. */}
      {!open && excerpt && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-1 block text-left w-full text-[11px] text-muted-foreground line-clamp-2 hover:text-foreground transition-colors"
        >
          {excerpt}
        </button>
      )}

      {open && (
        <div className="mt-2 space-y-2">
          {notApplied && (
            <p className="text-xs text-warning-700 bg-warning-50 rounded-lg px-3 py-2">
              {job.errorMsg}
            </p>
          )}
          {isDone && job.result ? (
            <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed bg-gray-50 rounded-lg px-3 py-2">
              {job.result}
            </p>
          ) : isFailed ? (
            <p className="text-xs text-red-400 bg-red-50 rounded-lg px-3 py-2">{job.errorMsg}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
