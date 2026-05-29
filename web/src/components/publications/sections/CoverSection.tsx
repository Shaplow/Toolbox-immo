"use client";

/**
 * CoverSection — section "Cover" de la fiche publication.
 *
 * Affiche la cover Instagram sélectionnée ou propose d'en choisir une
 * via l'outil cover dédié. UI varie selon pattern.coverMode :
 *  - none           : section masquée
 *  - manualSelect   : bouton "Choisir une frame" → outil dédié
 *  - autoPack       : status du pack + sélection finale
 *  - monteurUpload  : dropzone pour le monteur (Phase 2.5)
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ImageIcon, ExternalLink, AlertTriangle, Loader2, Upload } from "lucide-react";
import { toast } from "@/components/ui/Toast";

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
  /** true pour CM et ADMIN (mode autoPack / manualSelect) */
  canEdit: boolean;
  /** true pour MONTEUR assigné ou ADMIN quand mode=monteurUpload (Phase 2.5). */
  canMonteurUpload?: boolean;
  /** Rôle du viewer. MONTEUR ne voit la section que pour mode=monteurUpload. */
  viewerRole?: string;
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
  QUEUED:     "bg-gray-100 text-gray-700 border-gray-200",
  PROCESSING: "bg-gray-100 text-gray-700 border-gray-200",
  READY:      "bg-gray-100 text-gray-700 border-gray-200",
  SELECTED:   "bg-success-50 text-success-700 border-success-200",
  FAILED:     "bg-danger-50 text-danger-700 border-danger-200",
};

export function CoverSection({ slot, pattern, coverPack, coverConfigError, canEdit, canMonteurUpload = false, viewerRole, currentVersion }: Props) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);

  // Si pas de pattern ou que le pattern indique que la cover n'est pas nécessaire, on masque la section
  if (!pattern || pattern.coverMode === "none") return null;

  const mode = pattern.coverMode;

  // MONTEUR ne voit la cover QUE pour le mode monteurUpload. Les autres
  // modes (autoPack, manualSelect) sont du ressort CM/ADMIN — pour ne pas
  // que le monteur croie qu'il a quelque chose à faire.
  if (viewerRole === "MONTEUR" && mode !== "monteurUpload") {
    return null;
  }

  // B2-v2 : la sous-route /publications/[id]/cover résout la "cassure de
  // retour" qui faisait que /tools/cover ignorait slotId/returnTo. Le path
  // est désormais hiérarchisé et le breadcrumb retour fonctionne.
  const coverToolHref = `/publications/${slot.id}/cover`;

  async function handleUpload(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("Le fichier doit être une image (PNG, JPG, WEBP).");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast.error("Image trop volumineuse (max 20 Mo).");
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/publications/${slot.id}/upload-cover`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `Erreur ${res.status}`);
      }
      toast.success("Cover uploadée.");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur upload cover");
    } finally {
      setUploading(false);
    }
  }

  // ── Branche monteurUpload : dropzone pour le monteur ───────────────────────
  if (mode === "monteurUpload") {
    return (
      <section id="cover" className="bg-white border border-gray-100 rounded-2xl p-8">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <ImageIcon size={16} className="text-gray-400" />
            <h2 className="text-sm font-semibold text-gray-700">Cover</h2>
            <span className="text-[10px] uppercase tracking-[0.14em] text-gray-600 bg-gray-100 border border-gray-200 rounded-full px-2 py-0.5 font-medium">
              Monteur
            </span>
          </div>
          {coverPack?.finalCoverUrl && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs border font-medium bg-success-50 text-success-700 border-success-200">
              Livrée
            </span>
          )}
        </div>

        {coverPack?.finalCoverUrl ? (
          <div className="space-y-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={coverPack.finalCoverUrl}
              alt="Cover uploadée par le monteur"
              className="w-full max-w-sm rounded-lg border border-gray-100 object-cover aspect-square"
            />
            {canMonteurUpload && (
              <label className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors font-medium cursor-pointer">
                <Upload size={14} />
                Remplacer
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  disabled={uploading}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleUpload(file);
                  }}
                />
              </label>
            )}
          </div>
        ) : canMonteurUpload ? (
          <label className="block">
            <div
              className={`w-full flex flex-col items-center gap-2 py-10 px-6 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${
                uploading
                  ? "border-gray-400 bg-gray-50"
                  : "border-gray-200 hover:border-gray-400 hover:bg-gray-50"
              }`}
            >
              {uploading ? (
                <>
                  <Loader2 size={22} className="text-gray-700 animate-spin" />
                  <span className="text-sm text-gray-500">Upload en cours…</span>
                </>
              ) : (
                <>
                  <Upload size={22} className="text-gray-400" />
                  <span className="text-sm text-gray-600">Déposer la cover (PNG / JPG / WEBP)</span>
                  <span className="text-xs text-gray-400">Image carrée recommandée — max 20 Mo</span>
                </>
              )}
            </div>
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleUpload(file);
              }}
            />
          </label>
        ) : (
          <p className="text-sm text-gray-500">
            Le monteur uploadera la cover en livrant son montage.
          </p>
        )}
      </section>
    );
  }

  return (
    <section id="cover" className="bg-white border border-gray-100 rounded-2xl p-8">
      {/* En-tête section */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ImageIcon size={16} className="text-gray-400" />
          <h2 className="text-sm font-semibold text-gray-700">Cover</h2>
          {currentVersion && (
            <span className="text-xs text-gray-600 bg-gray-100 border border-gray-200 px-2 py-0.5 rounded-full font-medium">
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
        <div className="flex items-start gap-2 text-sm text-danger-700 bg-danger-50 border border-danger-200 rounded-lg p-3 mb-3">
          <AlertTriangle size={15} className="text-danger-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium">Extraction des frames échouée</p>
            {coverPack.errorMsg && (
              <p className="text-danger-700 mt-0.5">{coverPack.errorMsg}</p>
            )}
            <p className="text-xs text-danger-700/80 mt-1">
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

      {/* Cover pack créé mais pas encore de finalCoverUrl — selon le status
          du pack on distingue : pas encore prêt (QUEUED/PROCESSING) vs prêt
          à choisir (READY). Le bouton "Continuer" n'a de sens qu'en READY,
          sinon il mène sur un tool sans frames extraites. */}
      {coverPack && !coverPack.finalCoverUrl && coverPack.status !== "FAILED" && (
        <div className="space-y-3">
          {coverPack.status === "READY" ? (
            <>
              <p className="text-sm text-gray-500">
                Les frames sont prêtes — choisis la meilleure cover dans l&apos;outil dédié.
              </p>
              {canEdit && (
                <Link
                  href={coverToolHref}
                  className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-white bg-gray-950 rounded-md hover:bg-gray-800 transition-colors font-medium"
                >
                  <ExternalLink size={14} />
                  Continuer la sélection
                </Link>
              )}
            </>
          ) : (
            <div className="flex items-center gap-2 text-sm text-gray-500 bg-gray-50 rounded-lg p-3">
              <Loader2 size={14} className="animate-spin shrink-0 text-gray-400" />
              <span>
                Extraction des frames en cours… La cover sera sélectionnable dès que le pack sera prêt.
              </span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
