"use client";

/**
 * AssetCard — carte média (vidéo, image, audio) Liquid Glass.
 *
 * Factorise les patterns dupliqués dans MediaAssetsVideoCard, LibraryPicker
 * grids, CoverGenerator, RushesSection thumbnails, VersionsSection cards.
 *
 * Doctrine Liquid Glass v2 :
 * - Card glass avec ring inset signature.
 * - Thumbnail dominant (aspect ratio respecté) + footer compact.
 * - Selected : ring sky prononcé + halo signature.
 * - Hover : lift + shadow glass-md.
 * - Variant expanded : preview vidéo inline (VideoPlayer minimal) + metadata.
 *
 * 3 variants :
 * - `compact`  : ligne horizontale dense (h-14) — thumbnail 48×48 + texte
 *                + duration. Pour listes denses (admin tableaux, picker).
 * - `default`  : card aspect 9:16 ou 1:1 — thumbnail + footer (filename +
 *                duration + badges).
 * - `expanded` : grande carte avec VideoPlayer minimal inline + metadata
 *                detaillé.
 *
 * Props :
 * - `asset` : { id, url, filename, duration?, thumbnail?, mimeType?, metadata? }
 * - `variant`, `aspect` (pour default/expanded)
 * - `selectable` + `selected` + `onSelect`
 * - `onPlay`, `badges`, `actions`, `href`
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
  /** Click play button — sinon click thumbnail = lance VideoPlayer interne (expanded). */
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
  if (kind === "video") return <Video size={size} className="text-gray-500" />;
  if (kind === "image") return <ImageIcon size={size} className="text-gray-500" />;
  if (kind === "audio") return <Music size={size} className="text-gray-500" />;
  return <FileText size={size} className="text-gray-500" />;
}

// ─── Composant ──────────────────────────────────────────────────────────────

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

// ─── Compact ────────────────────────────────────────────────────────────────

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
        "flex items-center gap-3 px-3 py-2 rounded-lg transition-all",
        selected
          ? "bg-sky-50/60 backdrop-blur-[10px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(77,150,191,0.32),0_2px_8px_-2px_rgba(77,150,191,0.18)]"
          : "bg-gradient-to-b from-white/60 to-white/40 backdrop-blur-[10px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08),inset_0_-1px_0_rgba(15,23,42,0.04)] hover:from-white/75 hover:to-white/55 hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.14),0_2px_6px_rgba(15,23,42,0.06)]",
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
      {/* Thumbnail */}
      <div className="shrink-0 h-10 w-10 rounded-md bg-gray-100 overflow-hidden relative shadow-[inset_0_0_0_1px_rgba(15,23,42,0.06)]">
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
            className="absolute inset-0 flex items-center justify-center bg-black/30 backdrop-blur-[2px] text-white opacity-0 hover:opacity-100 transition-opacity"
          >
            <Play size={12} fill="currentColor" />
          </button>
        )}
      </div>
      {/* Text */}
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-gray-950 truncate">{asset.filename}</p>
        <div className="flex items-center gap-1.5 text-[11px] text-gray-500 mt-0.5">
          <KindIcon kind={kind} size={10} />
          {asset.duration !== undefined && (
            <span className="font-mono tabular-nums">{formatDuration(asset.duration)}</span>
          )}
          {badges && <span className="flex items-center gap-1">{badges}</span>}
        </div>
      </div>
      {/* Actions */}
      {actions && <div className="shrink-0 flex items-center gap-1">{actions}</div>}
    </div>
  );

  if (href) return <Link href={href}>{inner}</Link>;
  return inner;
}

// ─── Default ────────────────────────────────────────────────────────────────

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
    "group/asset relative rounded-xl overflow-hidden transition-all",
    selected
      ? "bg-sky-50/60 backdrop-blur-[12px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(77,150,191,0.4),0_4px_16px_-4px_rgba(77,150,191,0.32),0_12px_32px_-8px_rgba(77,150,191,0.28)]"
      : "bg-gradient-to-b from-white/55 to-white/30 backdrop-blur-[12px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08),inset_0_-1px_0_rgba(15,23,42,0.04),0_1px_3px_rgba(15,23,42,0.05)] hover:from-white/70 hover:to-white/45 hover:-translate-y-0.5 hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.14),0_4px_16px_-4px_rgba(15,23,42,0.14)]",
    className ?? "",
  ].filter(Boolean).join(" ");

  const inner = (
    <div className={cardCls}>
      {/* Thumbnail area */}
      <div className={`relative ${aspectCls} bg-gray-100 overflow-hidden`}>
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

        {/* Selection checkbox overlay top-left */}
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

        {/* Badges overlay top-right */}
        {badges && (
          <div className="absolute top-2 right-2 flex flex-wrap items-center gap-1 justify-end max-w-[60%]">
            {badges}
          </div>
        )}

        {/* Play overlay center (vidéo) */}
        {kind === "video" && onPlay && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPlay();
            }}
            aria-label="Lire"
            className="absolute inset-0 flex items-center justify-center bg-black/0 hover:bg-black/30 transition-colors group-hover/asset:bg-black/30"
          >
            <span
              className={[
                "inline-flex h-10 w-10 items-center justify-center rounded-full opacity-0 group-hover/asset:opacity-100 transition-opacity",
                "bg-gradient-to-b from-white/85 to-white/55 backdrop-blur-[16px] backdrop-saturate-150",
                "shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(255,255,255,0.45),0_2px_4px_rgba(15,23,42,0.08),0_12px_28px_-8px_rgba(15,23,42,0.32)]",
                "text-gray-900",
              ].join(" ")}
            >
              <Play size={14} strokeWidth={2.4} className="ml-0.5" fill="currentColor" />
            </span>
          </button>
        )}

        {/* Duration overlay bottom-right */}
        {asset.duration !== undefined && (
          <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-gray-950/65 backdrop-blur-[4px] text-[10px] font-mono text-white tabular-nums">
            {formatDuration(asset.duration)}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-2.5 flex items-center gap-2">
        <KindIcon kind={kind} size={12} />
        <p className="flex-1 text-[12px] font-medium text-gray-950 truncate">{asset.filename}</p>
        {actions && <div className="shrink-0 flex items-center gap-0.5">{actions}</div>}
      </div>
    </div>
  );

  if (href) return <Link href={href}>{inner}</Link>;
  return inner;
}

// ─── Expanded ───────────────────────────────────────────────────────────────

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
    "rounded-2xl overflow-hidden transition-all",
    selected
      ? "bg-sky-50/55 backdrop-blur-[12px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(77,150,191,0.4),0_4px_16px_-4px_rgba(77,150,191,0.28),0_12px_32px_-8px_rgba(77,150,191,0.28)]"
      : "bg-gradient-to-b from-white/55 to-white/30 backdrop-blur-[12px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08),0_2px_8px_-2px_rgba(15,23,42,0.08)]",
    className ?? "",
  ].filter(Boolean).join(" ");

  return (
    <div className={cardCls}>
      {/* Preview lecteur si vidéo, sinon thumbnail simple */}
      {kind === "video" ? (
        <VideoPlayer
          src={asset.url}
          poster={asset.thumbnail}
          aspect={aspect}
          variant="minimal"
          className="rounded-none"
        />
      ) : (
        <div className={`relative ${aspect === "9:16" ? "aspect-[9/16]" : aspect === "16:9" ? "aspect-video" : aspect === "1:1" ? "aspect-square" : ""} bg-gray-100`}>
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

      {/* Footer riche */}
      <div className="px-4 py-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <KindIcon kind={kind} size={13} />
              <p className="text-[14px] font-semibold text-gray-950 truncate">{asset.filename}</p>
            </div>
            {asset.duration !== undefined && (
              <p className="text-[11px] text-gray-500 font-mono tabular-nums">
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
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 pt-2 border-t border-white/40">
            {Object.entries(asset.metadata).map(([key, value]) => (
              <div key={key} className="min-w-0">
                <dt className="text-[10px] uppercase tracking-widest font-medium text-gray-500">
                  {key}
                </dt>
                <dd className="text-[12px] text-gray-800 truncate mt-0.5">{value}</dd>
              </div>
            ))}
          </dl>
        )}

        {actions && (
          <div className="flex items-center gap-2 pt-2 border-t border-white/40">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
