"use client";

/**
 * Avatar — image utilisateur ou fallback (initiales / icône).
 *
 * Doctrine Liquid Glass v2 :
 * - Fallback initiales : gradient blanc + ring inset spéculaire signature
 *   (pas un cercle gris plat).
 * - Status dot (online/away/offline) en bottom-right avec ring spéculaire
 *   pour signaler la présence.
 * - Option `ring` ajoute un anneau de focus signature (pour avatars actifs
 *   dans une liste, conversation, etc.).
 *
 * Sizes : xs (20px) | sm (24) | md (32, default) | lg (40) | xl (48).
 */

import type { ReactNode } from "react";
import { User } from "lucide-react";

type Size = "xs" | "sm" | "md" | "lg" | "xl";
type Fallback = "initial" | "icon";
type Status = "online" | "away" | "offline";

interface AvatarProps {
  src?: string;
  /** Nom complet — utilisé pour générer les initiales et le label sr-only. */
  name: string;
  fallback?: Fallback;
  size?: Size;
  /** Affiche un dot coloré en bottom-right. */
  status?: Status;
  /** Affiche un anneau focus signature autour de l'avatar. */
  ring?: boolean;
  className?: string;
}

const SIZE_CLS: Record<Size, string> = {
  xs: "h-5 w-5 text-[8px]",
  sm: "h-6 w-6 text-[9px]",
  md: "h-8 w-8 text-[11px]",
  lg: "h-10 w-10 text-[13px]",
  xl: "h-12 w-12 text-[15px]",
};

const ICON_SIZE: Record<Size, number> = {
  xs: 10,
  sm: 12,
  md: 14,
  lg: 18,
  xl: 22,
};

const STATUS_SIZE: Record<Size, string> = {
  xs: "h-1.5 w-1.5 -right-0.5 -bottom-0.5",
  sm: "h-2 w-2 -right-0.5 -bottom-0.5",
  md: "h-2.5 w-2.5 -right-0.5 -bottom-0.5",
  lg: "h-3 w-3 -right-0.5 -bottom-0.5",
  xl: "h-3.5 w-3.5 -right-0.5 -bottom-0.5",
};

const STATUS_BG: Record<Status, string> = {
  online:  "bg-sage-500",
  away:    "bg-peach-500",
  offline: "bg-gray-400",
};

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return (parts[0][0] ?? "?").toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({
  src,
  name,
  fallback = "initial",
  size = "md",
  status,
  ring = false,
  className,
}: AvatarProps) {
  const ringCls = ring
    ? "shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_2px_rgba(77,150,191,0.35),0_0_0_3px_rgba(169,209,230,0.32)]"
    : "shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08),inset_0_-1px_0_rgba(15,23,42,0.06),0_1px_2px_rgba(15,23,42,0.06)]";

  let inner: ReactNode;
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    inner = <img src={src} alt={name} className="h-full w-full object-cover" />;
  } else if (fallback === "icon") {
    inner = <User size={ICON_SIZE[size]} className="text-gray-600" />;
  } else {
    inner = (
      <span className="font-semibold text-gray-700 tracking-tight tabular-nums leading-none">
        {getInitials(name)}
      </span>
    );
  }

  return (
    <span
      className={[
        "relative inline-flex shrink-0 items-center justify-center rounded-full overflow-hidden",
        "bg-gradient-to-b from-white to-white/75 backdrop-blur-[6px]",
        SIZE_CLS[size],
        ringCls,
        className ?? "",
      ].filter(Boolean).join(" ")}
      role="img"
      aria-label={name}
    >
      {inner}
      {status && (
        <span
          className={[
            "absolute rounded-full",
            "shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_0_0_2px_rgba(255,255,255,0.9)]",
            STATUS_SIZE[size],
            STATUS_BG[status],
          ].join(" ")}
          aria-hidden
        />
      )}
    </span>
  );
}

/**
 * AvatarGroup — empile plusieurs avatars en overlay (max N visibles + "+X").
 */
export function AvatarGroup({
  avatars,
  max = 3,
  size = "md",
}: {
  avatars: Array<Omit<AvatarProps, "size"> & { id: string }>;
  max?: number;
  size?: Size;
}) {
  const visible = avatars.slice(0, max);
  const overflow = avatars.length - visible.length;

  const negativeMargin =
    size === "xs" ? "-ml-1.5"
    : size === "sm" ? "-ml-2"
    : size === "md" ? "-ml-2.5"
    : size === "lg" ? "-ml-3"
    : "-ml-3.5";

  return (
    <span className="inline-flex items-center">
      {visible.map((a, i) => (
        <span key={a.id} className={i === 0 ? "" : negativeMargin}>
          <Avatar {...a} size={size} />
        </span>
      ))}
      {overflow > 0 && (
        <span
          className={[
            negativeMargin,
            "inline-flex items-center justify-center rounded-full bg-gradient-to-b from-white to-white/75 backdrop-blur-[6px] font-semibold text-gray-700",
            "shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08),0_1px_2px_rgba(15,23,42,0.06)]",
            SIZE_CLS[size],
          ].join(" ")}
        >
          +{overflow}
        </span>
      )}
    </span>
  );
}
