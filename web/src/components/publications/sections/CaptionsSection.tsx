/**
 * CaptionsSection — section "Sous-titres" de la fiche publication.
 *
 * Intégration minimale Phase 1.3.5 : lien vers l'outil captions dédié.
 * L'édition inline des segments sera ajoutée dans une phase ultérieure
 * (pas de FK directe CaptionJob → PublicationSlot à ce stade).
 */

import Link from "next/link";
import { Subtitles, ExternalLink } from "lucide-react";

interface Props {
  slot: { id: string };
  renderId: string | null;
  pattern: { needsCaptions: boolean } | null;
  /** true pour CM, MONTEUR, et ADMIN */
  canEdit: boolean;
  /** Version courante promue par l'ADMIN (si needsRushes=true). */
  currentVersion?: { versionNumber: number; fileName: string } | null;
}

export function CaptionsSection({ slot, renderId, pattern, canEdit, currentVersion }: Props) {
  // Si le pattern n'exige pas de captions, on masque la section
  if (pattern?.needsCaptions !== true) return null;

  const captionsHref = renderId
    ? `/tools/captions?slotId=${slot.id}&renderId=${renderId}&returnTo=/publications/${slot.id}`
    : `/tools/captions?slotId=${slot.id}&returnTo=/publications/${slot.id}`;

  return (
    <section id="captions" className="bg-white border border-gray-100 rounded-xl p-6 shadow-sm">
      {/* En-tête section */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Subtitles size={16} className="text-gray-400" />
          <h2 className="text-sm font-semibold text-gray-700">Sous-titres</h2>
        </div>
        {currentVersion && (
          <span className="text-xs text-indigo-600 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-full font-medium">
            Lié à V{currentVersion.versionNumber} — {currentVersion.fileName}
          </span>
        )}
      </div>

      <div className="space-y-3">
        <p className="text-sm text-gray-500">
          Les sous-titres se gèrent dans l&apos;outil dédié : transcription, synchronisation et style
          sont configurables depuis l&apos;outil captions.
        </p>

        {canEdit ? (
          <Link
            href={captionsHref}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium"
          >
            <ExternalLink size={14} />
            Gérer les sous-titres
          </Link>
        ) : (
          <Link
            href={captionsHref}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors font-medium border border-indigo-200"
          >
            <ExternalLink size={14} />
            Voir les sous-titres
          </Link>
        )}
      </div>
    </section>
  );
}
