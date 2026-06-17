"use client";

/**
 * Avatar — image utilisateur ou fallback (initiales / icône) flat shadcn.
 *
 * Fallback initiales : bg-muted + text-foreground.
 * Status dot (online/away/offline) en bottom-right avec ring blanc.
 * Option `ring` ajoute un anneau primary subtle pour avatars actifs.
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
  name: string;
  fallback?: Fallback;
  size?: Size;
  status?: Status;
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
  online:  "bg-success-600",
  away:    "bg-warning-600",
  offline: "bg-zinc-400",
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
  const ringCls = ring ? "ring-2 ring-primary/40" : "border border-border";

  let inner: ReactNode;
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    inner = <img src={src} alt={name} className="h-full w-full object-cover" />;
  } else if (fallback === "icon") {
    inner = <User size={ICON_SIZE[size]} className="text-muted-foreground" />;
  } else {
    inner = (
      <span className="font-semibold text-foreground tracking-tight tabular-nums leading-none">
        {getInitials(name)}
      </span>
    );
  }

  return (
    <span
      className={[
        "relative inline-flex shrink-0 items-center justify-center rounded-full overflow-hidden bg-muted",
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
            "absolute rounded-full ring-2 ring-card",
            STATUS_SIZE[size],
            STATUS_BG[status],
          ].join(" ")}
          aria-hidden
        />
      )}
    </span>
  );
}

/** AvatarGroup — empile plusieurs avatars en overlay (max N + "+X"). */
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
            "inline-flex items-center justify-center rounded-full bg-muted text-foreground border border-border font-semibold",
            SIZE_CLS[size],
          ].join(" ")}
        >
          +{overflow}
        </span>
      )}
    </span>
  );
}
