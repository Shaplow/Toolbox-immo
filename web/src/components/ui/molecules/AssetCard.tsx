"use client";

/**
 * AssetCard — carte média (vidéo, image, audio) flat shadcn.
 *
 * Factorise MediaAssetsVideoCard, LibraryPicker grids, CoverGenerator,
 * RushesSection thumbnails, VersionsSection cards.
 *
 * 3 variants :
 * - compact  : ligne horizontale dense (h-14) — pour listes denses.
 * - default  : card avec thumbnail aspect + footer compact.
 * - expanded : carte avec VideoPlayer inline + metadata détaillé.
 *
 * Selected : ring primary + bg primary/5.
 */

import type { ReactNode } from "react";
import Link from "next/link";
import { FileText, Image as ImageIcon, Play, Video, Music } from "lucide-react";
import { VideoPlayer } from "./VideoPlayer";
import { Checkbox } from "../Checkbox";

type Variant = "compact" | "default" | "expanded";
type Aspect = "9:16" | "16:9" | "1:1" | "auto";

interface Asset {
  id: string;
  url: string;
  filename: string;
  duration?: number;
  thumbnail?: string;
  mimeType?: string;
  metadata?: Record<string, ReactNode>;
}

interface AssetCardProps {
  asset: Asset;
  variant?: Variant;
  aspect?: Aspect;
  selected?: boolean;
  selectable?: boolean;
  onSelect?: () => void;
  onPlay?: () => void;
  badges?: ReactNode;
  actions?: ReactNode;
  href?: string;
  className?: string;
}

function formatDuration(s?: number): string {
  if (s === undefined || !Number.isFinite(s) || s <= 0) return "";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function getKind(mimeType?: string, filename?: string): "video" | "image" | "audio" | "other" {
  const mt = (mimeType ?? "").toLowerCase();
  if (mt.startsWith("video/")) return "video";
  if (mt.startsWith("image/")) return "image";
  if (mt.startsWith("audio/")) return "audio";
  const ext = (filename ?? "").split(".").pop()?.toLowerCase() ?? "";
  if (["mp4", "mov", "webm", "mkv"].includes(ext)) return "video";
  if (["jpg", "jpeg", "png", "webp", "gif"].includes(ext)) return "image";
  if (["mp3", "wav", "m4a", "ogg"].includes(ext)) return "audio";
  return "other";
}

function KindIcon({ kind, size = 14 }: { kind: ReturnType<typeof getKind>; size?: number }) {
  if (kind === "video") return <Video size={size} className="text-muted-foreground" />;
  if (kind === "image") return <ImageIcon size={size} className="text-muted-foreground" />;
  if (kind === "audio") return <Music size={size} className="text-muted-foreground" />;
  return <FileText size={size} className="text-muted-foreground" />;
}

export function AssetCard({
  asset,
  variant = "default",
  aspect = "9:16",
  selected = false,
  selectable = false,
  onSelect,
  onPlay,
  badges,
  actions,
  href,
  className,
}: AssetCardProps) {
  if (variant === "compact") {
    return (
      <CompactCard
        asset={asset}
        selected={selected}
        selectable={selectable}
        onSelect={onSelect}
        onPlay={onPlay}
        badges={badges}
        actions={actions}
        href={href}
        className={className}
      />
    );
  }
  if (variant === "expanded") {
    return (
      <ExpandedCard
        asset={asset}
        aspect={aspect}
        selected={selected}
        selectable={selectable}
        onSelect={onSelect}
        badges={badges}
        actions={actions}
        className={className}
      />
    );
  }
  return (
    <DefaultCard
      asset={asset}
      aspect={aspect}
      selected={selected}
      selectable={selectable}
      onSelect={onSelect}
      onPlay={onPlay}
      badges={badges}
      actions={actions}
      href={href}
      className={className}
    />
  );
}

function CompactCard({
  asset,
  selected,
  selectable,
  onSelect,
  onPlay,
  badges,
  actions,
  href,
  className,
}: {
  asset: Asset;
  selected?: boolean;
  selectable?: boolean;
  onSelect?: () => void;
  onPlay?: () => void;
  badges?: ReactNode;
  actions?: ReactNode;
  href?: string;
  className?: string;
}) {
  const kind = getKind(asset.mimeType, asset.filename);

  const inner = (
    <div
      className={[
        "flex items-center gap-3 px-3 py-2 rounded-md border transition-colors",
        selected
          ? "bg-primary/5 border-primary/30"
          : "bg-card border-border hover:bg-muted",
        className ?? "",
      ].filter(Boolean).join(" ")}
    >
      {selectable && (
        <Checkbox
          checked={!!selected}
          onChange={() => onSelect?.()}
          size="sm"
          label={`Sélectionner ${asset.filename}`}
        />
      )}
      <div className="shrink-0 h-10 w-10 rounded-md bg-muted overflow-hidden relative border border-border">
        {asset.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={asset.thumbnail} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full flex items-center justify-center">
            <KindIcon kind={kind} size={14} />
          </div>
        )}
        {kind === "video" && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPlay?.();
            }}
            aria-label="Lire"
            className="absolute inset-0 flex items-center justify-center bg-zinc-950/40 text-white opacity-0 hover:opacity-100 transition-opacity"
          >
            <Play size={12} fill="currentColor" />
          </button>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-foreground truncate">{asset.filename}</p>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-0.5">
          <KindIcon kind={kind} size={10} />
          {asset.duration !== undefined && (
            <span className="font-mono tabular-nums">{formatDuration(asset.duration)}</span>
          )}
          {badges && <span className="flex items-center gap-1">{badges}</span>}
        </div>
      </div>
      {actions && <div className="shrink-0 flex items-center gap-1">{actions}</div>}
    </div>
  );

  if (href) return <Link href={href}>{inner}</Link>;
  return inner;
}

function DefaultCard({
  asset,
  aspect,
  selected,
  selectable,
  onSelect,
  onPlay,
  badges,
  actions,
  href,
  className,
}: {
  asset: Asset;
  aspect: Aspect;
  selected?: boolean;
  selectable?: boolean;
  onSelect?: () => void;
  onPlay?: () => void;
  badges?: ReactNode;
  actions?: ReactNode;
  href?: string;
  className?: string;
}) {
  const kind = getKind(asset.mimeType, asset.filename);
  const aspectCls = {
    "9:16": "aspect-[9/16]",
    "16:9": "aspect-video",
    "1:1":  "aspect-square",
    "auto": "",
  }[aspect];

  const cardCls = [
    "group/asset relative rounded-lg overflow-hidden border transition-colors",
    selected
      ? "bg-primary/5 border-primary/30 ring-2 ring-primary/20"
      : "bg-card border-border hover:bg-muted hover:border-zinc-300",
    className ?? "",
  ].filter(Boolean).join(" ");

  const inner = (
    <div className={cardCls}>
      <div className={`relative ${aspectCls} bg-muted overflow-hidden`}>
        {asset.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={asset.thumbnail}
            alt={asset.filename}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center">
            <KindIcon kind={kind} size={32} />
          </div>
        )}

        {selectable && (
          <div className="absolute top-2 left-2">
            <Checkbox
              checked={!!selected}
              onChange={() => onSelect?.()}
              size="md"
              label={`Sélectionner ${asset.filename}`}
            />
          </div>
        )}

        {badges && (
          <div className="absolute top-2 right-2 flex flex-wrap items-center gap-1 justify-end max-w-[60%]">
            {badges}
          </div>
        )}

        {kind === "video" && onPlay && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPlay();
            }}
            aria-label="Lire"
            className="absolute inset-0 flex items-center justify-center bg-zinc-950/0 hover:bg-zinc-950/40 transition-colors group-hover/asset:bg-zinc-950/40"
          >
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-full opacity-0 group-hover/asset:opacity-100 transition-opacity bg-card text-foreground border border-border shadow-lg">
              <Play size={14} strokeWidth={2.4} className="ml-0.5" fill="currentColor" />
            </span>
          </button>
        )}

        {asset.duration !== undefined && (
          <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-zinc-950/70 text-[10px] font-mono text-white tabular-nums">
            {formatDuration(asset.duration)}
          </div>
        )}
      </div>

      <div className="px-3 py-2.5 flex items-center gap-2">
        <KindIcon kind={kind} size={12} />
        <p className="flex-1 text-[12px] font-medium text-foreground truncate">{asset.filename}</p>
        {actions && <div className="shrink-0 flex items-center gap-0.5">{actions}</div>}
      </div>
    </div>
  );

  if (href) return <Link href={href}>{inner}</Link>;
  return inner;
}

function ExpandedCard({
  asset,
  aspect,
  selected,
  selectable,
  onSelect,
  badges,
  actions,
  className,
}: {
  asset: Asset;
  aspect: Aspect;
  selected?: boolean;
  selectable?: boolean;
  onSelect?: () => void;
  badges?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  const kind = getKind(asset.mimeType, asset.filename);

  const cardCls = [
    "rounded-lg overflow-hidden border bg-card transition-colors",
    selected ? "border-primary/30 ring-2 ring-primary/20" : "border-border",
    className ?? "",
  ].filter(Boolean).join(" ");

  return (
    <div className={cardCls}>
      {kind === "video" ? (
        <VideoPlayer
          src={asset.url}
          poster={asset.thumbnail}
          aspect={aspect}
          variant="minimal"
          className="rounded-none"
        />
      ) : (
        <div className={`relative ${aspect === "9:16" ? "aspect-[9/16]" : aspect === "16:9" ? "aspect-video" : aspect === "1:1" ? "aspect-square" : ""} bg-muted`}>
          {asset.thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={asset.thumbnail} alt={asset.filename} className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full flex items-center justify-center">
              <KindIcon kind={kind} size={40} />
            </div>
          )}
        </div>
      )}

      <div className="px-4 py-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <KindIcon kind={kind} size={13} />
              <p className="text-[14px] font-semibold text-foreground truncate">{asset.filename}</p>
            </div>
            {asset.duration !== undefined && (
              <p className="text-[11px] text-muted-foreground font-mono tabular-nums">
                {formatDuration(asset.duration)}
              </p>
            )}
          </div>
          {selectable && (
            <div className="shrink-0 mt-1">
              <Checkbox
                checked={!!selected}
                onChange={() => onSelect?.()}
                size="md"
                label={`Sélectionner ${asset.filename}`}
              />
            </div>
          )}
        </div>

        {badges && <div className="flex flex-wrap items-center gap-1.5">{badges}</div>}

        {asset.metadata && Object.keys(asset.metadata).length > 0 && (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 pt-2 border-t border-border">
            {Object.entries(asset.metadata).map(([key, value]) => (
              <div key={key} className="min-w-0">
                <dt className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">
                  {key}
                </dt>
                <dd className="text-[12px] text-foreground truncate mt-0.5">{value}</dd>
              </div>
            ))}
          </dl>
        )}

        {actions && (
          <div className="flex items-center gap-2 pt-2 border-t border-border">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
