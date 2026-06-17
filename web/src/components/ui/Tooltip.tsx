"use client";

import { useState, useRef, useEffect, type ReactNode } from "react";

/**
 * Tooltip simple — apparaît au hover/focus, disparaît au mouseleave/blur.
 *
 * Position absolue par défaut au-dessus (top), fallback bas si pas la place.
 * Délai d'ouverture : 200ms (évite les flashes au passage rapide).
 */
interface TooltipProps {
  content: ReactNode;
  side?: "top" | "bottom";
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
          className={`absolute left-1/2 -translate-x-1/2 z-50 pointer-events-none whitespace-nowrap rounded-md bg-zinc-900 px-2 py-1 text-[11px] font-medium text-white shadow-lg ${
            actualSide === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5"
          }`}
        >
          {content}
        </span>
      )}
    </span>
  );
}
