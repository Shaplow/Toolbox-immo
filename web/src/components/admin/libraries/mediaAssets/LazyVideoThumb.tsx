"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Miniature vidéo chargée uniquement quand elle entre dans le viewport.
 * Utilise IntersectionObserver avec rootMargin 200px pour précharger juste
 * avant le scroll. Évite de fetcher des dizaines de vidéos sur le mount.
 */
export function LazyVideoThumb({
  url,
  className,
}: {
  url: string;
  className: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | undefined>(undefined);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setSrc(`${url}#t=0.5`);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [url]);

  return <video ref={ref} src={src} muted preload="metadata" className={className} />;
}
