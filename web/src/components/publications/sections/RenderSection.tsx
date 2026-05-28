/**
 * RenderSection — section "Rendu vidéo" de la fiche publication.
 *
 * Affiche le rendu vidéo ou image lié au slot et propose les actions
 * de lancement / re-render vers le builder (admin uniquement).
 */

"use client";

import { useState } from "react";
import Link from "next/link";
import { Film, Play, RefreshCw, AlertCircle, RotateCcw, AlertTriangle } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { toast } from "@/components/ui/Toast";
import { useRouter } from "next/navigation";

interface Props {
  slot: { id: string };
  pattern: { source: string; templateId: string | null } | null;
  render: {
    id: string;
    status: string;
    videoUrl: string | null;
    pngUrl: string | null;
  } | null;
  /**
   * URL "finale" de la vidéo (avec captions incrustées si dispo, sinon vidéo brute
   * du render). Calculée par le caller via `getSlotFinalVideoUrl`. Si fournie,
   * remplace `render.videoUrl` pour l'affichage. Si null, on retombe sur le render.
   */
  finalVideoUrl?: string | null;
  /** true si `finalVideoUrl` est la version sous-titrée (vs version brute). */
  isCaptioned?: boolean;
  listingId: string | null;
  /** true pour les admins uniquement (re-render, lancer render) */
  canEdit: boolean;
}

const RENDER_STATUS_LABELS: Record<string, string> = {
  PENDING: "En attente",
  PROCESSING: "En cours",
  DONE: "Terminé",
  ERROR: "Erreur",
};

const RENDER_STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-yellow-50 text-yellow-700 border-yellow-200",
  PROCESSING: "bg-blue-50 text-blue-700 border-blue-200",
  DONE: "bg-green-50 text-green-700 border-green-200",
  ERROR: "bg-red-50 text-red-700 border-red-200",
};

export function RenderSection({ slot, pattern, render, finalVideoUrl, isCaptioned, listingId, canEdit }: Props) {
  const router = useRouter();
  const [confirmRevert, setConfirmRevert] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [confirmForceFail, setConfirmForceFail] = useState(false);
  const [forceFailing, setForceFailing] = useState(false);

  // URL effectivement affichée : version finale (avec captions si dispo), fallback render brut.
  const displayVideoUrl = finalVideoUrl ?? render?.videoUrl ?? null;
  // Si pas de pattern, pas de rendu possible — masquer la section
  if (!pattern) return null;

  const templateId = pattern?.templateId ?? null;
  const builderHref = templateId
    ? `/builder/${templateId}${listingId ? `?listingId=${listingId}&slotId=${slot.id}` : `?slotId=${slot.id}`}`
    : null;

  /** Force-fail un render stuck en PROCESSING/PENDING (admin recovery). */
  async function handleForceFail() {
    if (!render) return;
    setForceFailing(true);
    try {
      const res = await fetch(`/api/admin/renders/${render.id}/force-fail`, {
        method: "POST",
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error ?? "Échec du force-fail");
      }
      toast.success("Render forcé en ERROR. Rotation libérée — tu peux relancer.");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setForceFailing(false);
      setConfirmForceFail(false);
    }
  }

  /** Revert rotation consumption — admin recovery path quand le render est mauvais. */
  async function handleRevertRotation() {
    if (!render) return;
    setReverting(true);
    try {
      const res = await fetch(`/api/admin/renders/${render.id}/revert-usage`, {
        method: "POST",
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error ?? "Échec du revert");
      }
      const summary = (await res.json()) as {
        assets: { id: string; reverted: boolean }[];
        cursors: { libraryId: string; reverted: boolean }[];
        warnings: string[];
      };
      const okAssets = summary.assets.filter((a) => a.reverted).length;
      const okCursors = summary.cursors.filter((c) => c.reverted).length;
      toast.success(
        `Rotation revertée : ${okAssets} asset${okAssets > 1 ? "s" : ""} · ${okCursors} cursor${okCursors > 1 ? "s" : ""}` +
          (summary.warnings.length > 0 ? ` · ${summary.warnings.length} avertissement(s)` : ""),
      );
      if (summary.warnings.length > 0) {
        console.warn("[revert-usage warnings]", summary.warnings);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setReverting(false);
      setConfirmRevert(false);
    }
  }

  return (
    <section id="render" className="bg-white border border-gray-100 rounded-xl p-6 shadow-sm">
      {/* En-tête section */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Film size={16} className="text-gray-400" />
          <h2 className="text-sm font-semibold text-gray-700">Rendu vidéo</h2>
        </div>

        {render && (
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border font-medium ${
              RENDER_STATUS_COLORS[render.status] ?? "bg-gray-50 text-gray-600 border-gray-200"
            }`}
          >
            {RENDER_STATUS_LABELS[render.status] ?? render.status}
          </span>
        )}
      </div>

      {/* Cas : pattern sans template automatique */}
      {pattern?.source !== "auto_template" && (
        <div className="flex items-start gap-2 text-sm text-gray-500 bg-gray-50 rounded-lg p-3">
          <AlertCircle size={15} className="text-gray-400 mt-0.5 flex-shrink-0" />
          <span>
            Pas de rendu automatique pour ce type de publication — upload manuel prévu en Phase 1.4.
          </span>
        </div>
      )}

      {/* Cas : source auto_template sans render lancé */}
      {pattern?.source === "auto_template" && !render && (
        <div className="space-y-3">
          <p className="text-sm text-gray-500">Aucun rendu lancé pour ce slot.</p>
          {canEdit && builderHref && (
            <Link
              href={builderHref}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors font-medium"
            >
              <Play size={14} />
              Lancer le rendu
            </Link>
          )}
          {canEdit && !builderHref && (
            <p className="text-xs text-gray-400 italic">
              Aucun template associé à ce pattern — configurez un template d&apos;abord.
            </p>
          )}
        </div>
      )}

      {/* Cas : render présent avec vidéo */}
      {displayVideoUrl && (
        <div className="space-y-4">
          {isCaptioned && (
            <p className="inline-flex items-center gap-1.5 text-xs text-violet-700 bg-violet-50 border border-violet-200 px-2 py-1 rounded-md">
              <span className="w-1.5 h-1.5 rounded-full bg-violet-500" />
              Version avec sous-titres incrustés
            </p>
          )}
          <video
            key={displayVideoUrl}
            controls
            className="w-full max-w-xl rounded-lg border border-gray-100"
            style={{ maxHeight: 360 }}
          >
            <source src={displayVideoUrl} />
            Votre navigateur ne supporte pas la lecture vidéo.
          </video>

          {canEdit && (
            <div className="flex flex-wrap items-center gap-2">
              {builderHref && (
                <Link
                  href={builderHref}
                  className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors font-medium"
                >
                  <RefreshCw size={14} />
                  Re-render
                </Link>
              )}
              {render?.status === "DONE" && (
                <button
                  type="button"
                  onClick={() => setConfirmRevert(true)}
                  disabled={reverting}
                  className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors font-medium disabled:opacity-50"
                  title="Décrémente les compteurs et restaure les curseurs pour pouvoir re-piocher les mêmes assets"
                >
                  <RotateCcw size={14} />
                  Revert rotation
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Cas : render présent avec image uniquement (pas de vidéo) */}
      {render && !render.videoUrl && render.pngUrl && (
        <div className="space-y-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={render.pngUrl}
            alt="Rendu image"
            className="w-full max-w-xl rounded-lg border border-gray-100 object-contain"
            style={{ maxHeight: 360 }}
          />

          {canEdit && builderHref && (
            <Link
              href={builderHref}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors font-medium"
            >
              <RefreshCw size={14} />
              Re-render
            </Link>
          )}
        </div>
      )}

      {/* Cas : render en cours / erreur sans media */}
      {render && !render.videoUrl && !render.pngUrl && (
        <div className="space-y-2">
          <p className="text-sm text-gray-500">
            {render.status === "ERROR"
              ? "Le rendu a échoué."
              : "Rendu en cours de traitement…"}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {render.status === "ERROR" && canEdit && builderHref && (
              <Link
                href={builderHref}
                className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors font-medium"
              >
                <RefreshCw size={14} />
                Relancer le rendu
              </Link>
            )}
            {/* Force-fail visible quand le render semble bloqué (PROCESSING/PENDING/QUEUED). */}
            {canEdit &&
              (render.status === "PROCESSING" ||
                render.status === "PENDING" ||
                render.status === "QUEUED") && (
                <button
                  type="button"
                  onClick={() => setConfirmForceFail(true)}
                  disabled={forceFailing}
                  className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors font-medium disabled:opacity-50"
                  title="Bloquer le render et libérer la rotation pour pouvoir relancer"
                >
                  <AlertTriangle size={14} />
                  Force fail
                </button>
              )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmRevert}
        title="Revert la rotation pour ce render ?"
        description="Cette action décrémente les compteurs d'usage des MediaAssets et DataEntries consommés par ce render, et restaure les curseurs des libraries set-sequence si possible. À utiliser quand le rendu est mauvais et tu veux re-piocher les mêmes assets."
        confirmLabel="Revert"
        variant="danger"
        loading={reverting}
        onConfirm={() => { void handleRevertRotation(); }}
        onCancel={() => setConfirmRevert(false)}
      />
      <ConfirmDialog
        open={confirmForceFail}
        title="Forcer ce render en échec ?"
        description="Le render passera immédiatement en ERROR. Les MediaAssets et curseurs claim-és au prefill seront relâchés pour pouvoir re-piocher. À utiliser uniquement quand le render est bloqué (RunPod crash, heartbeat trop ancien, webhook perdu)."
        confirmLabel="Force fail"
        variant="danger"
        loading={forceFailing}
        onConfirm={() => { void handleForceFail(); }}
        onCancel={() => setConfirmForceFail(false)}
      />
    </section>
  );
}
