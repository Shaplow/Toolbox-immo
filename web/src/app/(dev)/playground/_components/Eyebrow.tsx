import type { ReactNode } from "react";

/** Petit label de section — uppercase, tracking large. À utiliser avec parcimonie. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-[10px] uppercase tracking-[0.14em] text-gray-400 font-medium">
      {children}
    </p>
  );
}
