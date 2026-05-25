/**
 * CoverSection — section "Cover" de la fiche publication.
 *
 * Affiche la cover Instagram sélectionnée ou propose d'en choisir une
 * via l'outil cover dédié.
 */

import Link from "next/link";
import { ImageIcon, ExternalLink } from "lucide-react";

interface Props {
  slot: { id: string };
  recipe: { needsCover: string } | null;
  coverPack: {
    id: string;
    status: string;
    finalCoverUrl: string | null;
  } | null;
  /** true pour CM et ADMIN */
  canEdit: boolean;
}

const COVER_STATUS_LABELS: Record<string, string> = {
  QUEUED: "En file",
  PROCESSING: "En cours",
  READY: "Frames prêtes",
  SELECTED: "Sélectionnée",
  FAILED: "Échec",
};

const COVER_STATUS_COLORS: Record<string, string> = {
  QUEUED: "bg-yellow-50 text-yellow-700 border-yellow-200",
  PROCESSING: "bg-blue-50 text-blue-700 border-blue-200",
  READY: "bg-indigo-50 text-indigo-700 border-indigo-200",
  SELECTED: "bg-green-50 text-green-700 border-green-200",
  FAILED: "bg-red-50 text-red-700 border-red-200",
};

export function CoverSection({ slot, recipe, coverPack, canEdit }: Props) {
  // Si la recipe indique que la cover n'est pas nécessaire, on masque la section
  if (recipe?.needsCover === "none") return null;

  const coverToolHref = `/tools/cover?slotId=${slot.id}&returnTo=/publications/${slot.id}`;

  return (
    <section id="cover" className="bg-white border border-gray-100 rounded-xl p-6 shadow-sm">
      {/* En-tête section */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ImageIcon size={16} className="text-gray-400" />
          <h2 className="text-sm font-semibold text-gray-700">Cover</h2>
        </div>

        {coverPack && (
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border font-medium ${
              COVER_STATUS_COLORS[coverPack.status] ?? "bg-gray-50 text-gray-600 border-gray-200"
            }`}
          >
            {COVER_STATUS_LABELS[coverPack.status] ?? coverPack.status}
          </span>
        )}
      </div>

      {/* Pas de cover pack */}
      {!coverPack && (
        <div className="space-y-3">
          <p className="text-sm text-gray-500">Aucune cover sélectionnée pour ce slot.</p>
          {canEdit && (
            <Link
              href={coverToolHref}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors font-medium"
            >
              <ExternalLink size={14} />
              Choisir une cover
            </Link>
          )}
        </div>
      )}

      {/* Cover sélectionnée avec image finale */}
      {coverPack?.finalCoverUrl && (
        <div className="space-y-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={coverPack.finalCoverUrl}
            alt="Cover sélectionnée"
            className="w-full max-w-sm rounded-lg border border-gray-100 object-cover aspect-square"
          />

          {canEdit && (
            <Link
              href={coverToolHref}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors font-medium"
            >
              <ExternalLink size={14} />
              Modifier la cover
            </Link>
          )}
        </div>
      )}

      {/* Cover pack créé mais pas encore de finalCoverUrl */}
      {coverPack && !coverPack.finalCoverUrl && (
        <div className="space-y-3">
          <p className="text-sm text-gray-500">
            Cover en cours de sélection — les frames sont prêtes à choisir.
          </p>
          {canEdit && (
            <Link
              href={coverToolHref}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors font-medium border border-indigo-200"
            >
              <ExternalLink size={14} />
              Continuer la sélection
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
