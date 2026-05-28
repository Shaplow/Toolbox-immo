"use client";

import { CoverPresetsPanel } from "./CoverPresetsPanel";

interface Props {
  templateId?: string;
}

/**
 * Onglet "Cover auto" du builder.
 * Wrapper léger autour de CoverPresetsPanel — affiche un message clair si le
 * template n'est pas encore sauvegardé (pas d'ID = pas de presets gérables).
 */
export function CoverTabPanel({ templateId }: Props) {
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
      <CoverPresetsPanel templateId={templateId} />
    </div>
  );
}
