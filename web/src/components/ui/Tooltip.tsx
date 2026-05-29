"use client";

import { useState, useRef, useEffect, type ReactNode } from "react";

/**
 * Tooltip simple — apparaît au hover/focus, disparaît au mouseleave/blur.
 *
 * Implémentation sans dépendance externe (Floating UI, Radix). Position
 * absolue par défaut au-dessus (top), avec fallback bas si pas la place
 * (calcul léger basé sur getBoundingClientRect).
 *
 * Pour des cas plus complexes (collision intelligente, virtual triggers),
 * on prendra Floating UI le moment venu.
 *
 * Délai d'ouverture : 200ms (évite les flashes au passage rapide).
 */
interface TooltipProps {
  /** Le contenu du tooltip — texte court ou raccourci clavier. */
  content: ReactNode;
  /** Position préférentielle. Default top. */
  side?: "top" | "bottom";
  /** Délai avant d'ouvrir (ms). Default 200. */
  delay?: number;
  children: ReactNode;
  className?: string;
}

export function Tooltip({ content, side = "top", delay = 200, children, className }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [actualSide, setActualSide] = useState<"top" | "bottom">(side);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function show() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      // Compute side : si on demande top mais qu'on est trop haut, fallback bottom.
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        if (side === "top" && rect.top < 40) setActualSide("bottom");
        else if (side === "bottom" && rect.bottom > window.innerHeight - 40) setActualSide("top");
        else setActualSide(side);
      }
      setOpen(true);
    }, delay);
  }

  function hide() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setOpen(false);
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <span
      ref={triggerRef}
      className={["relative inline-flex", className ?? ""].filter(Boolean).join(" ")}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          className={`absolute left-1/2 -translate-x-1/2 z-50 pointer-events-none whitespace-nowrap rounded-md bg-gray-950/90 backdrop-blur-[8px] backdrop-saturate-150 px-2 py-1 text-[11px] font-medium text-white shadow-[var(--shadow-overlay),inset_0_1px_0_rgba(255,255,255,0.08)] ${
            actualSide === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5"
          }`}
        >
          {content}
        </span>
      )}
    </span>
  );
}
