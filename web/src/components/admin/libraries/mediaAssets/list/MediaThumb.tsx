"use client";

import { Loader2, EyeOff } from "lucide-react";
import { LazyVideoThumb } from "../LazyVideoThumb";

/**
 * MediaThumb — vignette compacte réutilisable (vue liste noob).
 * S'appuie sur LazyVideoThumb (poster <img> rapide + <video> au hover) et
 * superpose les états job-en-cours / désactivé.
 */
export function MediaThumb({
  url,
  posterUrl,
  pending,
  disabled,
  className,
}: {
  url: string;
  posterUrl?: string | null;
  pending?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={`relative overflow-hidden bg-muted rounded ${className ?? ""}`}>
      <LazyVideoThumb url={url} posterUrl={posterUrl} className="w-full h-full object-cover" />
      {pending && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60">
          <Loader2 size={12} className="text-white animate-spin" />
        </div>
      )}
      {disabled && !pending && (
        <div className="absolute inset-0 flex items-center justify-center bg-warning-700/50">
          <EyeOff size={12} className="text-warning-100" />
        </div>
      )}
    </div>
  );
}
