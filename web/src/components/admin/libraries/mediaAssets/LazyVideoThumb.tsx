"use client";

import { memo, useEffect, useRef, useState } from "react";

/**
 * Miniature vidéo économe.
 *
 * - Si `posterUrl` est présent : affiche une image poster légère (<img>),
 *   TOUJOURS montée, et superpose la vidéo (<video>) au survol en fondu
 *   (absolute inset-0, opacity 0→100 sur `onLoadedData`). Le poster ne
 *   disparaît jamais tant que la frame vidéo n'est pas prête — plus de
 *   case grise pendant le fetch réseau (limite 6 connexions/host).
 * - Sinon (asset sans poster, ou poster en erreur) : ancien comportement —
 *   <video> chargé en lazy via IntersectionObserver (rootMargin 200px).
 *
 * Hover contrôlé ou interne : par défaut le composant gère son propre hover
 * via ses handlers (chemin historique, utilisé par MediaThumb /
 * MediaLibrariesPanel). MediaAssetsVideoCard passe `hovered` en contrôlé et
 * remonte les handlers sur le conteneur aspect-[9/16] de la card — l'overlay
 * Play (absolute inset-0, rendu après ce composant) intercepterait sinon les
 * events souris avant qu'ils n'atteignent ce composant, hors selectMode.
 */
// memo : la vignette (img/video) est le poids visuel. Ses props sont des strings
// stables → le mémo évite de re-render / re-décoder l'élément média quand la card
// parente se re-render (filtre/tri/scroll).
export const LazyVideoThumb = memo(function LazyVideoThumb({
  url,
  posterUrl,
  className,
  hovered: hoveredProp,
}: {
  url: string;
  posterUrl?: string | null;
  className: string;
  /** Hover contrôlé par le parent (cf. note ci-dessus). Omis = hover interne. */
  hovered?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [lazySrc, setLazySrc] = useState<string | undefined>(undefined);
  const [internalHovered, setInternalHovered] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  // Dernière src dont l'événement `loadedData` a fired. Comparée à `videoSrc`
  // au rendu (dérivé, pas d'effet) : ni le rule set-state-in-effect ni un
  // reset explicite ne sont nécessaires — la sortie de hover démonte le
  // <video> (cf. `showVideo` plus bas), donc `videoReady` ne "fuit" jamais
  // une frame obsolète. Un hover répété sur la même src (cache navigateur)
  // révèle directement sans re-fader, ce qui est le comportement voulu.
  const [loadedSrc, setLoadedSrc] = useState<string | undefined>(undefined);

  const isControlled = hoveredProp !== undefined;
  const hovered = isControlled ? hoveredProp : internalHovered;

  const usePoster = !!posterUrl && !posterFailed;
  // Au survol on charge la vidéo immédiatement (src dérivé, sans setState) ;
  // sinon on s'appuie sur le src lazy posé par l'IntersectionObserver.
  const videoSrc = hovered ? `${url}#t=0.5` : lazySrc;
  // Le <video> n'est monté que quand il a effectivement une src à charger :
  // au survol (chemin poster) ou une fois entré dans le viewport (chemin
  // sans poster). Jamais les deux à la fois pour tout le monde → pas de
  // préchargement massif quand on balaye la grille (limite 6 connexions/host).
  const showVideo = usePoster ? hovered : !!lazySrc;
  const videoReady = !!videoSrc && loadedSrc === videoSrc;

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

  // Le conteneur doit être un contexte de positionnement pour le <video>
  // en overlay (absolute inset-0). Si l'appelant a déjà posé une classe de
  // position (ex. MediaLibrariesPanel passe "absolute inset-0…"), on ne
  // touche à rien : "absolute" fournit déjà ce contexte.
  const hasPositionClass = /(?:^|\s)(?:absolute|relative|fixed|sticky)(?:\s|$)/.test(className);

  return (
    <div
      ref={containerRef}
      className={className}
      style={hasPositionClass ? undefined : { position: "relative" }}
      {...(isControlled
        ? {}
        : {
            onMouseEnter: () => setInternalHovered(true),
            onMouseLeave: () => setInternalHovered(false),
          })}
    >
      {usePoster && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={posterUrl as string}
          loading="lazy"
          alt=""
          className="w-full h-full object-cover"
          onError={() => setPosterFailed(true)}
        />
      )}
      {showVideo && (
        <video
          key={videoSrc}
          src={videoSrc}
          muted
          // `src` est déjà gaté par l'IntersectionObserver (lazySrc posé seulement
          // à l'entrée dans le viewport) → `preload="metadata"` ne charge la 1re
          // frame que pour les vignettes SANS poster VISIBLES. Sans ça (preload
          // "none"), ces vignettes restaient grises au lieu d'afficher le rush.
          preload="metadata"
          onLoadedData={() => setLoadedSrc(videoSrc)}
          className={
            usePoster
              ? `absolute inset-0 w-full h-full object-cover transition-opacity duration-150 ${
                  videoReady ? "opacity-100" : "opacity-0"
                }`
              : "w-full h-full object-cover"
          }
        />
      )}
    </div>
  );
});
