"use client";

import { useEffect, useState } from "react";

/**
 * Renvoie l'id de la section actuellement la plus visible dans le viewport.
 * Utilise IntersectionObserver avec une zone d'activation située dans le tiers
 * supérieur (rootMargin "-100px 0px -60% 0px").
 */
export function useScrollSpy(ids: string[], { offset = 100 }: { offset?: number } = {}) {
  const [activeId, setActiveId] = useState<string | null>(ids[0] ?? null);
  const idsKey = ids.join("|");

  useEffect(() => {
    const idList = idsKey ? idsKey.split("|") : [];
    if (idList.length === 0) return;

    const elements = idList
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => Boolean(el));

    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
        const topMost = visible.reduce((best, e) =>
          e.boundingClientRect.top < best.boundingClientRect.top ? e : best,
        );
        setActiveId(topMost.target.id);
      },
      { rootMargin: `-${offset}px 0px -60% 0px`, threshold: 0 },
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [idsKey, offset]);

  return activeId;
}
