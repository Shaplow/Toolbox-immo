/**
 * CoverSection — section "Cover" de la fiche publication.
 *
 * Affiche la cover Instagram sélectionnée ou propose d'en choisir une
 * via l'outil cover dédié.
 */

import Link from "next/link";
import { ImageIcon, ExternalLink, AlertTriangle } from "lucide-react";

interface Props {
  slot: { id: string };
  pattern: { coverMode: string } | null;
  coverPack: {
    id: string;
    status: string;
    finalCoverUrl: string | null;
    errorMsg?: string | null;
  } | null;
  /**
   * Warning de configuration cover : aucun pack créé alors qu'attendu
   * (preset introuvable, coverPresetName manquant, etc.). Calculé côté server
   * en lisant la dernière activity COVER_CONFIG_ERROR si pas de pack.
   */
  coverConfigError?: {
    reason: string;
    presetName?: string;
    message: string;
  } | null;
  /** true pour CM et ADMIN */
  canEdit: boolean;
  /** Version courante promue par l'ADMIN (si needsRushes=true). */
  currentVersion?: { versionNumber: number; fileName: string } | null;
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

export function CoverSection({ slot, pattern, coverPack, coverConfigError, canEdit, currentVersion }: Props) {
  // Si pas de pattern ou que le pattern indique que la cover n'est pas nécessaire, on masque la section
  if (!pattern || pattern.coverMode === "none") return null;

  // B2-v2 : la sous-route /publications/[id]/cover résout la "cassure de
  // retour" qui faisait que /tools/cover ignorait slotId/returnTo. Le path
  // est désormais hiérarchisé et le breadcrumb retour fonctionne.
  const coverToolHref = `/publications/${slot.id}/cover`;

  return (
    <section id="cover" className="bg-white border border-gray-100 rounded-xl p-6 shadow-sm">
      {/* En-tête section */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ImageIcon size={16} className="text-gray-400" />
          <h2 className="text-sm font-semibold text-gray-700">Cover</h2>
          {currentVersion && (
            <span className="text-xs text-indigo-600 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-full font-medium">
              Lié à V{currentVersion.versionNumber}
            </span>
          )}
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

      {/* Pas de cover pack — soit non démarré (config OK), soit config error */}
      {!coverPack && coverConfigError && (
        <div className="space-y-3">
          <div className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
            <AlertTriangle size={15} className="text-amber-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium">Cover auto bloquée</p>
              <p className="text-amber-700 mt-0.5">{coverConfigError.message}</p>
              <p className="text-xs text-amber-600 mt-1">
                Vérifiez la configuration cover du pattern lié à ce slot
                (preset référencé manquant ou supprimé).
              </p>
            </div>
          </div>
          {canEdit && (
            <Link
              href={coverToolHref}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium"
            >
              <ExternalLink size={14} />
              Choisir une cover manuellement
            </Link>
          )}
        </div>
      )}

      {!coverPack && !coverConfigError && (
        <div className="space-y-3">
          <p className="text-sm text-gray-500">Aucune cover sélectionnée pour ce slot.</p>
          {canEdit && (
            <Link
              href={coverToolHref}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium"
            >
              <ExternalLink size={14} />
              Choisir une cover
            </Link>
          )}
        </div>
      )}

      {/* Cover pack FAILED — bandeau d'erreur d'extraction */}
      {coverPack?.status === "FAILED" && (
        <div className="flex items-start gap-2 text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg p-3 mb-3">
          <AlertTriangle size={15} className="text-red-500 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium">Extraction des frames échouée</p>
            {coverPack.errorMsg && (
              <p className="text-red-700 mt-0.5">{coverPack.errorMsg}</p>
            )}
            <p className="text-xs text-red-600 mt-1">
              Relancez la sélection ou choisissez une cover manuellement.
            </p>
          </div>
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
