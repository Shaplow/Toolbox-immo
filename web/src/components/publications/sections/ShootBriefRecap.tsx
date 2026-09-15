"use client";

/**
 * ShootBriefRecap — le brief écrit par le vidéaste sur la FICHE de tournage,
 * repris en lecture sur la publication du monteur.
 *
 * Pourquoi un rappel et pas un second endroit d'écriture : le vidéaste travaille
 * depuis la fiche (c'est là qu'il dépose ses rushs et son vocal), le monteur
 * depuis la publication. Le mot doit voyager sans que personne n'ait à savoir
 * où l'autre travaille.
 *
 * Titré par son ORIGINE (« Brief du tournage ») et non par sa nature : une
 * publication peut porter en plus son propre brief éditorial, et deux blocs
 * nommés pareil seraient pires que pas de brief du tout.
 */

import { useState } from "react";
import { Mic, Paperclip, ClipboardList } from "lucide-react";
import { toast } from "@/components/ui/Toast";

interface Attachment {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number | null;
}

export function ShootBriefRecap({
  entityId,
  brief,
  attachments,
}: {
  entityId: string;
  brief: string | null;
  attachments: Attachment[];
}) {
  const [busy, setBusy] = useState<string | null>(null);

  async function download(att: Attachment) {
    setBusy(att.id);
    try {
      const res = await fetch(`/api/entities/${entityId}/brief/attachments/${att.id}`);
      if (!res.ok) throw new Error();
      const { downloadUrl } = (await res.json()) as { downloadUrl: string };
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = att.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      toast.error("Téléchargement impossible.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="inline-flex items-center gap-1.5 text-[13px] font-semibold tracking-tight text-foreground">
        <ClipboardList size={13} className="text-muted-foreground" />
        Brief du tournage
      </h3>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        Écrit par le vidéaste sur la fiche. Lecture seule ici.
      </p>

      {brief && (
        <p className="mt-2 text-[13px] leading-snug text-foreground whitespace-pre-wrap">{brief}</p>
      )}

      {attachments.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {attachments.map((att) => (
            <li key={att.id} className="flex items-center gap-2">
              {att.mimeType.startsWith("audio/") ? (
                <Mic size={13} className="shrink-0 text-muted-foreground" />
              ) : (
                <Paperclip size={13} className="shrink-0 text-muted-foreground" />
              )}
              <button
                type="button"
                onClick={() => void download(att)}
                disabled={busy === att.id}
                className="flex-1 min-w-0 text-left text-[13px] text-foreground truncate hover:underline disabled:opacity-50"
              >
                {att.fileName}
              </button>
              {att.sizeBytes != null && (
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                  {Math.max(1, Math.round(att.sizeBytes / 1024))} Ko
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
