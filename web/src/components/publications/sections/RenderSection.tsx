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

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Film,
  RefreshCw,
  AlertCircle,
  RotateCcw,
  AlertTriangle,
  Loader2,
  Upload,
} from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Section } from "@/components/ui/molecules/Section";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Alert } from "@/components/ui/Alert";
import { EmptyState } from "@/components/ui/EmptyState";
import { VideoPlayer } from "@/components/ui/molecules/VideoPlayer";
import { toast } from "@/components/ui/Toast";
import { useRouter } from "next/navigation";
import { useJobEvent } from "@/lib/hooks/jobEventBus";

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
  /**
   * V8.10 — true quand le pipeline captions est en cours (QUEUED/PROCESSING)
   * ET qu'une vidéo brute existe déjà. Affiche un badge "Sous-titres en cours
   * d'incrustation" au-dessus du player pour expliquer que la version visible
   * n'est PAS encore finale (pas pour montrer un écran noir).
   */
  pendingCaptionsBurnIn?: boolean;
  listingId: string | null;
  canEdit: boolean;
  sectionId?: string;
  storageKey?: string;
  defaultOpen?: boolean;
  collapsible?: boolean;
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
  pendingCaptionsBurnIn = false,
  listingId,
  canEdit,
  sectionId = "render",
  storageKey,
  defaultOpen = true,
  collapsible = false,
}: Props) {
  const router = useRouter();
  const [confirmRevert, setConfirmRevert] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [confirmForceFail, setConfirmForceFail] = useState(false);
  const [forceFailing, setForceFailing] = useState(false);

  // Polling SSE — quand le webhook RunPod termine le render, on rafraîchit
  // la fiche pour récupérer videoUrl + status. Sans ça, l'utilisateur reste
  // bloqué sur "Rendu en cours de traitement…" jusqu'à un F5 manuel.
  const renderId = render?.id ?? null;
  const renderStatus = render?.status ?? null;
  const renderEvent = useJobEvent(renderId ?? "");
  useEffect(() => {
    if (!renderEvent || !renderStatus) return;
    if (renderEvent.status !== renderStatus) router.refresh();
  }, [renderEvent, renderStatus, router]);

  const displayVideoUrl = finalVideoUrl ?? render?.videoUrl ?? null;

  if (!pattern) return null;
  if (pattern.source !== "auto_template" && !render) return null;

  const templateId = pattern?.templateId ?? null;
  // Fix bug 2026-05-30 : pointait sur /builder (éditeur template), mais le user
  // veut LANCER une génération → /generate (formulaire de gen, comme le drawer
  // "Ouvrir le formulaire de génération"). GeneratePage résout accountId côté
  // serveur depuis slotId, donc pas besoin de passer accountId en URL.
  const builderHref = templateId
    ? `/generate/${templateId}${listingId ? `?listingId=${listingId}&slotId=${slot.id}` : `?slotId=${slot.id}`}`
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
    <Section
      title="Rendu vidéo"
      icon={Film}
      sectionId={sectionId}
      storageKey={storageKey}
      defaultOpen={defaultOpen}
      collapsible={collapsible}
      actions={
        statusBadge ? (
          <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
        ) : null
      }
    >

      {/* Cas : pattern manuel sans render auto — info glass tinted neutre.
          Le wording dépend de la source pour clarifier qui fait quoi. */}
      {pattern?.source === "manual_rushes" && (
        <div className="flex items-start gap-2 text-[12px] text-gray-700 bg-white/60 backdrop-blur-[8px] rounded-lg p-3 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)]">
          <Upload size={14} className="text-gray-500 mt-0.5 flex-shrink-0" />
          <span className="leading-relaxed">
            Vidéo livrée par le monteur depuis ses rushes —
            {" "}
            <a
              href="#versions"
              className="font-medium text-gray-900 underline decoration-gray-300 underline-offset-2 hover:decoration-gray-500"
            >
              voir les versions déposées
            </a>
            .
          </span>
        </div>
      )}
      {pattern?.source === "external_upload" && (
        <div className="flex items-start gap-2 text-[12px] text-gray-700 bg-white/60 backdrop-blur-[8px] rounded-lg p-3 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)]">
          <Upload size={14} className="text-gray-500 mt-0.5 flex-shrink-0" />
          <span className="leading-relaxed">
            Vidéo uploadée directement par le client — pas de rushes, pas de montage interne.
          </span>
        </div>
      )}

      {/* Cas : source auto_template sans render lancé */}
      {pattern?.source === "auto_template" && !render && (
        canEdit && builderHref ? (
          <EmptyState
            icon={Film}
            title="Aucun rendu"
            cta={{
              label: "Lancer le rendu",
              onClick: () => window.open(builderHref, "_blank", "noopener,noreferrer"),
            }}
          />
        ) : canEdit && !builderHref ? (
          <EmptyState
            icon={AlertCircle}
            title="Template manquant"
            description="Ce pattern n'a pas de template associé — configure-le pour pouvoir lancer le rendu."
            cta={{
              label: "Configurer un template",
              onClick: () => window.open("/admin/accounts", "_blank", "noopener,noreferrer"),
            }}
          />
        ) : (
          <EmptyState
            icon={Film}
            title="Aucun rendu"
            description="Le rendu n'a pas encore été lancé."
          />
        )
      )}

      {/* Cas : render présent avec vidéo — VideoPlayer molecule glass */}
      {displayVideoUrl && (
        <div className="space-y-4">
          {isCaptioned && (
            <Badge variant="info" dot>
              Version avec sous-titres incrustés
            </Badge>
          )}
          {/* V8.10 — Avant on affichait juste un VideoPlayer src=null
              quand finalVideoUrl était null ET captions en cours, ce qui
              donnait un écran noir. Maintenant : on rend la vidéo brute
              du render + un badge explicite "version finale en cours de
              préparation" pour éviter l'écran muet. */}
          {pendingCaptionsBurnIn && !isCaptioned && (
            <div className="rounded-xl bg-gradient-to-b from-sky-50/85 to-sky-50/55 backdrop-blur-[10px] backdrop-saturate-150 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(96,165,250,0.30)]">
              <p className="text-[12px] text-sky-900 flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-full bg-sky-500 animate-pulse" />
                <strong>Aperçu sans sous-titres</strong> — la version finale
                avec sous-titres incrustés sera disponible une fois les
                captions terminées.
              </p>
            </div>
          )}
          <div className="max-w-[280px] mx-auto">
            <VideoPlayer
              key={displayVideoUrl}
              src={displayVideoUrl}
              variant="minimal"
              aspect="9:16"
              glassChrome
              loop
            />
          </div>

          {canEdit && (
            <div className="flex flex-wrap items-center gap-2">
              {builderHref && (
                <Link
                  href={builderHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Ouvre le builder dans un nouvel onglet"
                >
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
          <div className="max-w-[280px] rounded-2xl overflow-hidden bg-gradient-to-b from-white to-white/80 backdrop-blur-[10px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08),0_2px_8px_-2px_rgba(15,23,42,0.08)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={render.pngUrl}
              alt="Rendu image"
              className="w-full object-contain"
            />
          </div>
          {canEdit && builderHref && (
            <Link
              href={builderHref}
              target="_blank"
              rel="noopener noreferrer"
              title="Ouvre le builder dans un nouvel onglet"
            >
              <Button variant="secondary" size="sm" icon={RefreshCw}>
                Re-render
              </Button>
            </Link>
          )}
        </div>
      )}

      {/* Cas : render en cours — Alert glass uniforme (pattern P4 audit V1) */}
      {render && !render.videoUrl && !render.pngUrl && render.status !== "ERROR" && (
        <div className="space-y-3">
          <Alert variant="glass" icon={Loader2}>
            Rendu en cours de traitement…
          </Alert>
          {canEdit && (
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
      )}

      {/* Cas : render en erreur — EmptyState rose + relance */}
      {render && !render.videoUrl && !render.pngUrl && render.status === "ERROR" && (
        canEdit && builderHref ? (
          <EmptyState
            icon={AlertTriangle}
            title="Rendu en échec"
            cta={{
              label: "Relancer le rendu",
              onClick: () => window.open(builderHref, "_blank", "noopener,noreferrer"),
            }}
          />
        ) : (
          <EmptyState
            icon={AlertTriangle}
            title="Rendu en échec"
            description="Le rendu a échoué."
          />
        )
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
    </Section>
  );
}
