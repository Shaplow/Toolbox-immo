"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { NAV, anchorIdsForPath } from "../_lib/navigation";
import { useScrollSpy } from "../_lib/useScrollSpy";

/**
 * Sidebar nav du playground.
 *
 * - Familles repliées visuellement par "Eyebrow + items".
 * - L'item actif est :
 *   1) l'ancre courante détectée par useScrollSpy (si on est dans une page avec ancres)
 *   2) à défaut, l'item dont le href === pathname courant.
 *
 * Pas de drawer / sheet mobile pour l'instant — le playground reste un outil
 * interne desktop-first. À ajouter si besoin.
 */
export function PlaygroundSidebar() {
  const pathname = usePathname() ?? "/playground";
  const ids = anchorIdsForPath(pathname);
  const activeAnchorId = useScrollSpy(ids, { offset: 120 });
  const activeRef = useRef<HTMLAnchorElement | null>(null);

  function isActive(href: string) {
    if (href.includes("#")) {
      const [path, anchor] = href.split("#");
      return pathname === path && activeAnchorId === anchor;
    }
    return pathname === href;
  }

  // Auto-scroll l'item actif uniquement au changement de page (pathname),
  // pas à chaque update du scrollspy (sinon le scroll manuel est repris par
  // le smooth-scroll en boucle, l'user ne peut plus atteindre la fin de la
  // nav). `block: "center"` laisse de la marge dans les 2 sens pour que
  // l'user puisse ensuite scroller librement vers le haut ou le bas.
  useEffect(() => {
    if (!activeRef.current) return;
    activeRef.current.scrollIntoView({ block: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return (
    <aside className="sticky top-16 hidden lg:block max-h-[calc(100vh-4rem)] overflow-y-auto pl-8 pr-4 pt-8 pb-40 [scrollbar-width:thin]">
      <nav className="space-y-7 text-[13px]">
        {NAV.map((section) => (
          <div key={section.label} className="space-y-1.5">
            <p className="text-[10px] uppercase tracking-[0.14em] text-gray-400 font-medium px-2">
              {section.label}
            </p>
            <ul className="space-y-px">
              {section.items.map((item) => {
                const active = isActive(item.href);
                return (
                  <li key={item.href}>
                    <Link
                      ref={active ? activeRef : undefined}
                      href={item.href}
                      className={[
                        "block rounded-md px-2 py-1 transition-colors leading-snug",
                        active
                          ? "bg-gray-100 text-gray-950 font-medium"
                          : "text-gray-600 hover:text-gray-950 hover:bg-gray-50",
                      ].join(" ")}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
