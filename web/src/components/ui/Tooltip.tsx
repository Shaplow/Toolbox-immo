"use client";

import { useState, useRef, useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useAnchoredPosition, POPOVER_Z_INDEX } from "./useAnchoredPosition";

/**
 * Tooltip simple — apparaît au hover/focus, disparaît au mouseleave/blur.
 *
 * PORTALÉ vers `document.body` : en `absolute`, la bulle était coupée par le
 * premier ancêtre en overflow-hidden. Sur une icône en bord de `Card` ou dans
 * une cellule de `Table`, l'aide était tronquée voire invisible — précisément
 * là où elle sert.
 *
 * `preferTop` reproduit le comportement historique (bulle au-dessus) ; le
 * retournement et le recadrage horizontal sont désormais gérés par le hook,
 * qui mesure réellement la bulle au lieu d'un seuil fixe de 40px.
 *
 * Délai d'ouverture : 200ms (évite les flashes au passage rapide).
 */
interface TooltipProps {
  content: ReactNode;
  side?: "top" | "bottom";
  delay?: number;
  children: ReactNode;
  className?: string;
}

/** Hauteur d'une bulle une ligne — pilote le retournement. */
const TOOLTIP_HEIGHT = 26;

export function Tooltip({ content, side = "top", delay = 200, children, className }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { position, ready } = useAnchoredPosition(open, triggerRef, {
    maxHeight: TOOLTIP_HEIGHT,
    gap: 6,
    preferTop: side === "top",
    align: "center",
    popoverRef: bubbleRef,
  });

  function show() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setOpen(true), delay);
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
      {ready && position &&
        createPortal(
          <span
            ref={bubbleRef}
            role="tooltip"
            style={{
              position: "absolute",
              top: position.top,
              left: position.left,
              zIndex: POPOVER_Z_INDEX,
            }}
            className="pointer-events-none whitespace-nowrap rounded-md bg-zinc-900 px-2 py-1 text-[11px] font-medium text-white shadow-lg"
          >
            {content}
          </span>,
          document.body,
        )}
    </span>
  );
}
