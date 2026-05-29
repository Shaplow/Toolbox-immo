/**
 * RenderSection — section "Rendu vidéo" de la fiche publication.
 *
 * UX décisions Phase 3 (migration ui-boost) :
 * - 4 boutons inline (Lancer, Re-render, Revert rotation, Force fail,
 *   Relancer) → Button primitives avec icônes Lucide. Cohérence absolue
 *   d'apparence — l'admin voit la même grammaire d'action partout.
 * - "Lancer le rendu" / "Relancer" → variant primary (action critique).
 * - "Re-render" → variant secondary (action de re-traitement, pas
 *   destructive mais courante).
 * - "Revert rotation" → variant secondary (admin recovery, pas
 *   immédiatement destructive — confirme avec ConfirmDialog).
 * - "Force fail" → variant danger (libère la rotation, irréversible).
 * - Status badge → Badge primitive (4 variants sémantiques success/info/
 *   warning-via-default/danger selon RENDER_STATUS).
 * - "Version avec sous-titres" → Badge variant="info" (au lieu de violet
 *   inline pop). C'est une info technique, pas un highlight.
 * - "Aucun template associé" italic gray-400 → text gray-500 simple.
 * - Density resserrée : px-6 py-6 rounded-xl shadow-sm → px-5 rounded-lg.
 */

"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Film,
  Play,
  RefreshCw,
  AlertCircle,
  RotateCcw,
  AlertTriangle,
} from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
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
  finalVideoUrl?: string | null;
  isCaptioned?: boolean;
  listingId: string | null;
  canEdit: boolean;
}

const RENDER_STATUS_LABELS: Record<string, string> = {
  PENDING: "En attente",
  PROCESSING: "En cours",
  DONE: "Terminé",
  ERROR: "Erreur",
};

function getRenderStatusBadge(
  status: string,
): { variant: "default" | "success" | "danger" | "info"; label: string } {
  const label = RENDER_STATUS_LABELS[status] ?? status;
  if (status === "DONE") return { variant: "success", label };
  if (status === "ERROR") return { variant: "danger", label };
  if (status === "PROCESSING") return { variant: "info", label };
  return { variant: "default", label };
}

export function RenderSection({
  slot,
  pattern,
  render,
  finalVideoUrl,
  isCaptioned,
  listingId,
  canEdit,
}: Props) {
  const router = useRouter();
  const [confirmRevert, setConfirmRevert] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [confirmForceFail, setConfirmForceFail] = useState(false);
  const [forceFailing, setForceFailing] = useState(false);

  const displayVideoUrl = finalVideoUrl ?? render?.videoUrl ?? null;

  if (!pattern) return null;
  if (pattern.source !== "auto_template" && !render) return null;

  const templateId = pattern?.templateId ?? null;
  const builderHref = templateId
    ? `/builder/${templateId}${listingId ? `?listingId=${listingId}&slotId=${slot.id}` : `?slotId=${slot.id}`}`
    : null;

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

  const statusBadge = render ? getRenderStatusBadge(render.status) : null;

  return (
    <section id="render" className="bg-white border border-gray-100 rounded-2xl p-8">
      {/* En-tête section */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Film size={14} className="text-gray-500" />
          <h2 className="text-[13px] font-semibold text-gray-950">Rendu vidéo</h2>
        </div>
        {statusBadge && (
          <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
        )}
      </div>

      {/* Cas : pattern manuel sans render auto */}
      {pattern?.source !== "auto_template" && (
        <div className="flex items-start gap-2 text-[13px] text-gray-600 bg-gray-50 rounded-md p-3">
          <AlertCircle size={14} className="text-gray-400 mt-0.5 flex-shrink-0" />
          <span className="leading-relaxed">
            Ce slot utilise une vidéo livrée manuellement par le monteur (pas de
            rendu auto depuis un template).
          </span>
        </div>
      )}

      {/* Cas : source auto_template sans render lancé */}
      {pattern?.source === "auto_template" && !render && (
        <div className="space-y-3">
          <p className="text-[13px] text-gray-600">Aucun rendu lancé pour ce slot.</p>
          {canEdit && builderHref && (
            <Link href={builderHref} className="focus-ring rounded-md inline-block">
              <Button icon={Play}>Lancer le rendu</Button>
            </Link>
          )}
          {canEdit && !builderHref && (
            <p className="text-[12px] text-gray-500">
              Aucun template associé à ce pattern — configurez un template d&apos;abord.
            </p>
          )}
        </div>
      )}

      {/* Cas : render présent avec vidéo */}
      {displayVideoUrl && (
        <div className="space-y-4">
          {isCaptioned && (
            <Badge variant="info" dot>
              Version avec sous-titres incrustés
            </Badge>
          )}
          <video
            key={displayVideoUrl}
            controls
            className="w-full max-w-xl rounded-md border border-gray-200"
            style={{ maxHeight: 360 }}
          >
            <source src={displayVideoUrl} />
            Votre navigateur ne supporte pas la lecture vidéo.
          </video>

          {canEdit && (
            <div className="flex flex-wrap items-center gap-2">
              {builderHref && (
                <Link href={builderHref} className="focus-ring rounded-md inline-block">
                  <Button variant="secondary" size="sm" icon={RefreshCw}>
                    Re-render
                  </Button>
                </Link>
              )}
              {render?.status === "DONE" && (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={RotateCcw}
                  onClick={() => setConfirmRevert(true)}
                  disabled={reverting}
                  title="Décrémente les compteurs et restaure les curseurs pour pouvoir re-piocher les mêmes assets"
                >
                  Revert rotation
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Cas : render présent avec image uniquement */}
      {render && !render.videoUrl && render.pngUrl && (
        <div className="space-y-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={render.pngUrl}
            alt="Rendu image"
            className="w-full max-w-xl rounded-md border border-gray-200 object-contain"
            style={{ maxHeight: 360 }}
          />
          {canEdit && builderHref && (
            <Link href={builderHref} className="focus-ring rounded-md inline-block">
              <Button variant="secondary" size="sm" icon={RefreshCw}>
                Re-render
              </Button>
            </Link>
          )}
        </div>
      )}

      {/* Cas : render en cours / erreur sans media */}
      {render && !render.videoUrl && !render.pngUrl && (
        <div className="space-y-3">
          <p className="text-[13px] text-gray-600">
            {render.status === "ERROR"
              ? "Le rendu a échoué."
              : "Rendu en cours de traitement…"}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {render.status === "ERROR" && canEdit && builderHref && (
              <Link href={builderHref} className="focus-ring rounded-md inline-block">
                <Button icon={RefreshCw}>Relancer le rendu</Button>
              </Link>
            )}
            {canEdit &&
              (render.status === "PROCESSING" ||
                render.status === "PENDING" ||
                render.status === "QUEUED") && (
                <Button
                  variant="danger"
                  size="sm"
                  icon={AlertTriangle}
                  onClick={() => setConfirmForceFail(true)}
                  disabled={forceFailing}
                  title="Bloquer le render et libérer la rotation pour pouvoir relancer"
                >
                  Force fail
                </Button>
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
        onConfirm={() => {
          void handleRevertRotation();
        }}
        onCancel={() => setConfirmRevert(false)}
      />
      <ConfirmDialog
        open={confirmForceFail}
        title="Forcer ce render en échec ?"
        description="Le render passera immédiatement en ERROR. Les MediaAssets et curseurs claim-és au prefill seront relâchés pour pouvoir re-piocher. À utiliser uniquement quand le render est bloqué (RunPod crash, heartbeat trop ancien, webhook perdu)."
        confirmLabel="Force fail"
        variant="danger"
        loading={forceFailing}
        onConfirm={() => {
          void handleForceFail();
        }}
        onCancel={() => setConfirmForceFail(false)}
      />
    </section>
  );
}
