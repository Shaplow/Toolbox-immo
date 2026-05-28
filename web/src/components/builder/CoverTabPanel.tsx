"use client";

import { useEffect, useState } from "react";
import { Link2 } from "lucide-react";
import Link from "next/link";
import { CoverPresetsPanel } from "./CoverPresetsPanel";

interface Props {
  templateId?: string;
}

interface LinkedPattern {
  id: string;
  label: string;
  isActive: boolean;
  accountId: string;
  accountHandle: string;
  coverPresetName: string | null;
  coverEnabled: boolean;
}

/**
 * Onglet "Cover auto" du builder.
 * Wrapper léger autour de CoverPresetsPanel — affiche un message clair si le
 * template n'est pas encore sauvegardé (pas d'ID = pas de presets gérables).
 *
 * Si on a un templateId, on affiche aussi la liste des patterns qui utilisent
 * ce template pour montrer l'impact des changements sur le calendrier.
 */
export function CoverTabPanel({ templateId }: Props) {
  const [linkedPatterns, setLinkedPatterns] = useState<LinkedPattern[]>([]);

  useEffect(() => {
    if (!templateId) return;
    let active = true;
    fetch(`/api/templates/${templateId}/usage`)
      .then((r) => (r.ok ? (r.json() as Promise<{ patterns: LinkedPattern[] }>) : { patterns: [] }))
      .then((data) => { if (active) setLinkedPatterns(data.patterns); })
      .catch(() => {});
    return () => { active = false; };
  }, [templateId]);

  if (!templateId) {
    return (
      <div className="flex flex-col h-full overflow-y-auto text-xs">
        <div className="px-3 py-4 text-center text-gray-500">
          <p className="mb-1 font-medium text-gray-700">Cover auto indisponible</p>
          <p className="text-[11px] text-gray-400">
            Sauvegarde d&apos;abord le template pour configurer les presets de cover.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto text-xs">
      <div className="px-3 py-3 border-b border-gray-100">
        <p className="text-[11px] text-gray-500">
          Les presets définissent les zones, le format et l&apos;ordre des covers générées
          automatiquement après chaque rendu. Chaque pattern de publication peut sélectionner
          un preset par défaut depuis la fiche compte.
        </p>
      </div>

      {linkedPatterns.length > 0 && (
        <div className="px-3 py-3 border-b border-gray-100">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-2 flex items-center gap-1">
            <Link2 size={10} />
            Patterns utilisant ce template ({linkedPatterns.length})
          </p>
          <div className="space-y-1">
            {linkedPatterns.map((p) => (
              <Link
                key={p.id}
                href={`/admin/accounts/${p.accountId}`}
                className="flex items-center justify-between gap-2 px-2 py-1.5 rounded hover:bg-gray-50 transition-colors group"
                title="Voir la fiche compte"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-gray-700 truncate group-hover:text-gray-900">{p.label}</span>
                    {!p.isActive && (
                      <span className="text-[9px] px-1 rounded bg-gray-100 text-gray-500 border border-gray-200 shrink-0">
                        inactif
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-gray-400 truncate">@{p.accountHandle}</p>
                </div>
                {p.coverEnabled && p.coverPresetName ? (
                  <span
                    className="text-[9px] px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 border border-violet-200 shrink-0 max-w-[80px] truncate"
                    title={`Preset cover : ${p.coverPresetName}`}
                  >
                    {p.coverPresetName}
                  </span>
                ) : (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 border border-gray-200 shrink-0">
                    {p.coverEnabled ? "—" : "off"}
                  </span>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}

      <CoverPresetsPanel templateId={templateId} />
    </div>
  );
}
