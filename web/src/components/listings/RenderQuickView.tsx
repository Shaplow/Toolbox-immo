"use client";

/**
 * RenderQuickView — modal carrousel pour prévisualiser un render et ses
 * variantes (autres renders du même listing) sans quitter /listings.
 *
 * - Media contraint à max-h-[55vh] pour rentrer dans l'écran avec le footer.
 * - Navigation prev/next quand renders.length > 1 (chevrons + compteur).
 * - Footer : actions Régénérer (vers /generate) + Télécharger (anchor download).
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Download, RotateCw } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { ButtonIcon } from "@/components/ui/ButtonIcon";

export type QuickViewRender = {
  id: string;
  status: string;
  pngUrl: string | null;
  videoUrl: string | null;
};

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  templateId: string | null;
  listingId: string;
  renders: QuickViewRender[];
  initialRenderId: string;
}

function getDownloadInfo(r: QuickViewRender): { url: string; ext: string } | null {
  if (r.videoUrl) return { url: r.videoUrl, ext: "mp4" };
  if (r.pngUrl) return { url: r.pngUrl, ext: "png" };
  return null;
}

export function RenderQuickView({
  open,
  onClose,
  title,
  templateId,
  listingId,
  renders,
  initialRenderId,
}: Props) {
  const router = useRouter();

  // Filtre à l'affichage : on ne montre que les renders avec un media résolu.
  // Les PENDING/PROCESSING/ERROR sans pngUrl ni videoUrl n'ont rien à montrer.
  const playable = useMemo(
    () => renders.filter((r) => r.pngUrl || r.videoUrl),
    [renders],
  );
  const initialIndex = Math.max(
    0,
    playable.findIndex((r) => r.id === initialRenderId),
  );
  const [index, setIndex] = useState(initialIndex);

  // Navigation clavier — confort important pour passer en revue rapidement.
  useEffect(() => {
    if (!open || playable.length <= 1) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") setIndex((i) => (i - 1 + playable.length) % playable.length);
      if (e.key === "ArrowRight") setIndex((i) => (i + 1) % playable.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, playable.length]);

  if (playable.length === 0) {
    return (
      <Modal open={open} onClose={onClose} size="md">
        <Modal.Header onClose={onClose}>{title}</Modal.Header>
        <Modal.Body>
          <p className="text-[13px] text-muted-foreground text-center py-8">
            Aucun aperçu disponible pour cette génération.
          </p>
        </Modal.Body>
      </Modal>
    );
  }

  const current = playable[index];
  const dl = getDownloadInfo(current);
  const hasPrev = playable.length > 1;
  const canRegen = !!templateId;

  return (
    <Modal open={open} onClose={onClose} size="xl">
      <Modal.Header onClose={onClose}>
        <span className="inline-flex items-center gap-2">
          <span className="truncate">{title}</span>
          {playable.length > 1 && (
            <span className="text-[11px] font-medium text-muted-foreground tabular-nums shrink-0">
              {index + 1} / {playable.length}
            </span>
          )}
        </span>
      </Modal.Header>
      <Modal.Body className="px-5 py-4">
        {/* Stage media — fond neutre glass, media object-contain pour respecter
            le format quel qu'il soit (vertical 9:16, carré, paysage). */}
        <div className="relative rounded-2xl bg-gradient-to-b from-gray-50/80 to-gray-100/60  overflow-hidden">
          <div className="flex items-center justify-center min-h-[40vh] max-h-[55vh]">
            {current.videoUrl ? (
              <video
                key={current.id}
                src={current.videoUrl}
                controls
                playsInline
                className="block max-h-[55vh] max-w-full w-auto h-auto rounded-xl"
              />
            ) : current.pngUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={current.id}
                src={current.pngUrl}
                alt={title}
                className="block max-h-[55vh] max-w-full w-auto h-auto object-contain"
              />
            ) : null}
          </div>

          {/* Chevrons navigation — floating glass, ne masquent pas le media */}
          {hasPrev && (
            <>
              <div className="absolute inset-y-0 left-2 flex items-center pointer-events-none">
                <span className="pointer-events-auto">
                  <ButtonIcon
                    icon={ChevronLeft}
                    label="Précédent"
                    variant="glass"
                    size="md"
                    floating
                    onClick={() =>
                      setIndex((i) => (i - 1 + playable.length) % playable.length)
                    }
                  />
                </span>
              </div>
              <div className="absolute inset-y-0 right-2 flex items-center pointer-events-none">
                <span className="pointer-events-auto">
                  <ButtonIcon
                    icon={ChevronRight}
                    label="Suivant"
                    variant="glass"
                    size="md"
                    floating
                    onClick={() => setIndex((i) => (i + 1) % playable.length)}
                  />
                </span>
              </div>
            </>
          )}
        </div>

        {/* Dots indicators sous le media — visibles quand >1 variante */}
        {hasPrev && (
          <div className="flex items-center justify-center gap-1.5 mt-3">
            {playable.map((r, i) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Variante ${i + 1}`}
                className={`h-1.5 rounded-full transition-all ${
                  i === index ? "bg-gray-700 w-5" : "bg-gray-300 w-1.5 hover:bg-gray-400"
                }`}
              />
            ))}
          </div>
        )}
      </Modal.Body>
      <Modal.Footer>
        {canRegen && (
          <Button
            variant="secondary"
            size="sm"
            icon={RotateCw}
            onClick={() => {
              onClose();
              router.push(`/generate/${templateId}?listingId=${listingId}`);
            }}
          >
            Régénérer
          </Button>
        )}
        {dl && (
          <a
            href={dl.url}
            download
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[13px] font-medium bg-gradient-to-b from-gray-700 to-gray-900 text-white  hover:from-gray-600 hover:to-gray-800 transition-all focus-ring"
          >
            <Download size={14} />
            Télécharger {dl.ext.toUpperCase()}
          </a>
        )}
      </Modal.Footer>
    </Modal>
  );
}
