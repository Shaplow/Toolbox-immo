"use client";

import { memo, useEffect, useRef, useState } from "react";

/**
 * Miniature vidéo économe.
 *
 * - Si `posterUrl` est présent : affiche une image poster légère (<img>) par
 *   défaut et ne charge la vidéo (<video>) qu'au survol pour un aperçu animé.
 *   C'est le chemin rapide — la grille n'a plus à fetcher des dizaines de
 *   fichiers vidéo entiers.
 * - Sinon (asset sans poster, ou poster en erreur) : ancien comportement —
 *   <video> chargé en lazy via IntersectionObserver (rootMargin 200px).
 */
// memo : la vignette (img/video) est le poids visuel. Ses props sont des strings
// stables → le mémo évite de re-render / re-décoder l'élément média quand la card
// parente se re-render (filtre/tri/scroll).
export const LazyVideoThumb = memo(function LazyVideoThumb({
  url,
  posterUrl,
  className,
}: {
  url: string;
  posterUrl?: string | null;
  className: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [lazySrc, setLazySrc] = useState<string | undefined>(undefined);
  const [hovered, setHovered] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);

  const usePoster = !!posterUrl && !posterFailed;
  // Au survol on charge la vidéo immédiatement (src dérivé, sans setState) ;
  // sinon on s'appuie sur le src lazy posé par l'IntersectionObserver.
  const videoSrc = hovered ? `${url}#t=0.5` : lazySrc;

  useEffect(() => {
    // Chemin poster : la vidéo n'est montrée qu'au hover (src dérivé) — pas
    // besoin d'observer. Seul le chemin sans poster lazy-load via l'observer.
    if (usePoster) return;
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setLazySrc(`${url}#t=0.5`);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [url, usePoster]);

  return (
    <div
      ref={containerRef}
      className={className}
      onMouseEnter={() => setHovered(true)}
    >
      {usePoster && !hovered ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={posterUrl as string}
          loading="lazy"
          alt=""
          className="w-full h-full object-cover"
          onError={() => setPosterFailed(true)}
        />
      ) : (
        <video
          src={videoSrc}
          muted
          // Hors survol on ne veut PAS télécharger les headers de chaque vidéo
          // (coûteux en scroll sur les assets sans poster) — on ne précharge les
          // metadata qu'au hover, quand on va réellement montrer un aperçu animé.
          preload={hovered ? "metadata" : "none"}
          className="w-full h-full object-cover"
        />
      )}
    </div>
  );
});
