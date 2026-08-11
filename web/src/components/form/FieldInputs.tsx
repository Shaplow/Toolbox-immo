"use client";

/**
 * FieldInputs — composants de rendu d'un champ de formulaire (image,
 * video, audio, select, etc.) extraits de ListingForm.
 *
 * Phase F2-step1 du plan recentré. ListingForm contenait inline 5
 * sous-composants (~510 LOC) qui sont autonomes — ils sont déplacés ici
 * pour réduire la masse cognitive de ListingForm et permettre la
 * réutilisation future (ex. GenerateForm standalone, schema preview).
 *
 * Constantes partagées :
 * - DEFAULT_MEDIA_PREVIEW_ASPECT_RATIO (16/9)
 * - MAX_MEDIA_PREVIEW_HEIGHT (420 px)
 *
 * Pas de logique business ici — uniquement le rendu + l'upload via
 * `onUpload(file)`. Le parent gère le state (values, uploadProgress)
 * et les handlers.
 */

import { useEffect, useState, useRef } from "react";
import type { SchemaField } from "@/types/template";
import { UPLOAD_LIMITS, formatMaxSize } from "@/lib/upload/limits";

const DEFAULT_MEDIA_PREVIEW_ASPECT_RATIO = 16 / 9;
const MAX_MEDIA_PREVIEW_HEIGHT = 420;

// ─────────────────────────────────────────────────────────────────────────
// SelectFieldInput — select natif + chargement dynamique d'options
// (ig-accounts-from-library, metadata-values-from-library)
// ─────────────────────────────────────────────────────────────────────────

export function SelectFieldInput({
  field,
  value,
  onChange,
  controlClassName,
}: {
  field: SchemaField;
  value: string;
  onChange: (v: unknown) => void;
  controlClassName: string;
}) {
  const [dynamicOptions, setDynamicOptions] = useState<{ value: string; label: string }[] | null>(null);

  useEffect(() => {
    if (!field.optionsSource) return;
    const { type, libraryId } = field.optionsSource;

    if (type === "ig-accounts-from-library") {
      fetch(`/api/admin/libraries/media/${libraryId}/ig-accounts`)
        .then((r) => r.ok ? r.json() : { accounts: [] })
        .then((data: { accounts: { handle: string; name: string }[] }) => {
          setDynamicOptions(data.accounts.map((a) => ({ value: a.handle, label: `${a.name} (@${a.handle})` })));
        })
        .catch(() => setDynamicOptions([]));
    } else if (type === "metadata-values-from-library") {
      const metadataKey = field.optionsSource.metadataKey;
      if (!metadataKey) return;
      fetch(`/api/admin/libraries/media/${libraryId}/metadata-values?key=${encodeURIComponent(metadataKey)}`)
        .then((r) => r.ok ? r.json() : { values: [] })
        .then((data: { values: string[] }) => {
          setDynamicOptions(data.values.map((v) => ({ value: v, label: v })));
        })
        .catch(() => setDynamicOptions([]));
    }
  }, [field.optionsSource?.type, field.optionsSource?.libraryId, field.optionsSource?.metadataKey]);

  const options: { value: string; label: string }[] = dynamicOptions
    ?? (field.options ?? []).map((o) => ({ value: o, label: o }));

  const isLoading = field.optionsSource && dynamicOptions === null;
  const isMetaValues = field.optionsSource?.type === "metadata-values-from-library";

  return (
    <div className="flex flex-col gap-1">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={isLoading}
        className={controlClassName}
      >
        <option value="">{isLoading ? "Chargement…" : "—"}</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      {isMetaValues && !value && (
        <span className="text-[10px] text-info-700">
          Valeur sélectionnée automatiquement depuis l&apos;asset si laissé vide.
        </span>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// ImageFieldInput — image avec preview + focal point picker (drag/click)
// ─────────────────────────────────────────────────────────────────────────

export function ImageFieldInput({
  value,
  previewAspectRatio,
  focalPoint,
  onUpload,
  onFocalChange,
  uploadProgress,
}: {
  value: unknown;
  previewAspectRatio?: number;
  focalPoint: { x: number; y: number } | null;
  onUpload: (f: File) => void;
  onFocalChange: (fp: { x: number; y: number }) => void;
  uploadProgress?: number | null;
}) {
  const imageUrl = typeof value === "string" && value ? value : null;
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const fp = focalPoint ?? { x: 0.5, y: 0.5 };
  const aspectRatio = previewAspectRatio && Number.isFinite(previewAspectRatio) && previewAspectRatio > 0
    ? previewAspectRatio
    : DEFAULT_MEDIA_PREVIEW_ASPECT_RATIO;
  const previewMaxWidth = MAX_MEDIA_PREVIEW_HEIGHT * aspectRatio;

  if (uploadProgress !== null && uploadProgress !== undefined) {
    return (
      <div className="w-full h-32 border-2 border-dashed border-info-200 rounded-xl flex flex-col items-center justify-center gap-3 bg-info-50 px-6">
        <div className="w-full bg-gray-200 rounded-full h-1.5">
          <div
            className="bg-info-200 h-1.5 rounded-full transition-all duration-300"
            style={{ width: `${uploadProgress}%` }}
          />
        </div>
        <p className="text-xs text-info-700 font-medium">Upload… {uploadProgress}%</p>
      </div>
    );
  }

  function getFocalFromEvent(e: React.MouseEvent | MouseEvent) {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    onFocalChange({ x, y });
  }

  if (!imageUrl) {
    return (
      <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-border rounded-xl cursor-pointer hover:border-info-200 hover:bg-info-50 transition-colors group">
        <span className="text-2xl text-muted-foreground/60 group-hover:text-info-600 transition-colors">↑</span>
        <span className="text-sm font-medium text-muted-foreground group-hover:text-info-700 mt-1">Cliquer pour choisir une image</span>
        <span className="text-xs text-muted-foreground/60 mt-0.5">JPG · PNG · WEBP</span>
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])}
        />
      </label>
    );
  }

  return (
    <div className="space-y-2">
      <div
        ref={containerRef}
        className="relative w-full rounded-xl overflow-hidden cursor-crosshair border border-border select-none mx-auto"
        style={{
          aspectRatio: String(aspectRatio),
          maxWidth: `${previewMaxWidth}px`,
          maxHeight: `${MAX_MEDIA_PREVIEW_HEIGHT}px`,
        }}
        onMouseDown={(e) => { dragging.current = true; getFocalFromEvent(e); }}
        onMouseMove={(e) => { if (dragging.current) getFocalFromEvent(e); }}
        onMouseUp={() => { dragging.current = false; }}
        onMouseLeave={() => { dragging.current = false; }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt=""
          draggable={false}
          className="absolute inset-0 w-full h-full object-cover pointer-events-none"
          style={{ objectPosition: `${fp.x * 100}% ${fp.y * 100}%` }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent pointer-events-none" />
        <div
          className="absolute pointer-events-none"
          style={{
            left: `${fp.x * 100}%`,
            top: `${fp.y * 100}%`,
            transform: "translate(-50%, -50%)",
          }}
        >
          <div className="w-7 h-7 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.3)] flex items-center justify-center">
            <div className="w-1.5 h-1.5 rounded-full bg-white" />
          </div>
        </div>
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/50 text-white text-[10px] px-2 py-0.5 rounded-full pointer-events-none whitespace-nowrap">
          Cliquez ou glissez pour définir le point focal
        </div>
      </div>
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-muted-foreground">
          Point focal : {Math.round(fp.x * 100)}% / {Math.round(fp.y * 100)}%
        </p>
        <label className="text-xs text-info-700 hover:text-info-700 cursor-pointer hover:underline">
          Changer l&apos;image
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])}
          />
        </label>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// VideoFieldInput — video avec preview muted/loop + focal point picker
// ─────────────────────────────────────────────────────────────────────────

export function VideoFieldInput({
  value,
  previewAspectRatio,
  focalPoint,
  onUpload,
  onFocalChange,
  uploadProgress,
}: {
  value: unknown;
  previewAspectRatio?: number;
  focalPoint: { x: number; y: number } | null;
  onUpload: (f: File) => void;
  onFocalChange: (fp: { x: number; y: number }) => void;
  uploadProgress?: number | null;
}) {
  const videoUrl = typeof value === "string" && value ? value : null;
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const fp = focalPoint ?? { x: 0.5, y: 0.5 };
  const aspectRatio = previewAspectRatio && Number.isFinite(previewAspectRatio) && previewAspectRatio > 0
    ? previewAspectRatio
    : DEFAULT_MEDIA_PREVIEW_ASPECT_RATIO;
  const previewMaxWidth = MAX_MEDIA_PREVIEW_HEIGHT * aspectRatio;

  function getFocalFromEvent(e: React.MouseEvent | MouseEvent) {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    onFocalChange({ x, y });
  }

  if (uploadProgress !== null && uploadProgress !== undefined) {
    return (
      <div className="w-full h-32 border-2 border-dashed border-info-200 rounded-xl flex flex-col items-center justify-center gap-3 bg-info-50 px-6">
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-info-200 h-2 rounded-full transition-all duration-300"
            style={{ width: `${uploadProgress}%` }}
          />
        </div>
        <p className="text-xs text-info-700 font-medium">Upload en cours… {uploadProgress}%</p>
      </div>
    );
  }

  if (!videoUrl) {
    return (
      <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-border rounded-xl cursor-pointer hover:border-info-200 hover:bg-info-50 transition-colors group">
        <span className="text-2xl text-muted-foreground/60 group-hover:text-info-600 transition-colors">🎬</span>
        <span className="text-sm font-medium text-muted-foreground group-hover:text-info-700 mt-1">Cliquer pour choisir une vidéo</span>
        <span className="text-xs text-muted-foreground/60 mt-0.5">MP4 · MOV · WEBM — max {formatMaxSize(UPLOAD_LIMITS.VIDEO_ASSET_MAX_BYTES)}</span>
        <input
          type="file"
          accept="video/mp4,video/quicktime,video/x-m4v,video/webm"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])}
        />
      </label>
    );
  }

  return (
    <div className="space-y-2">
      <div
        ref={containerRef}
        className="relative w-full rounded-xl overflow-hidden cursor-crosshair border border-border select-none mx-auto"
        style={{
          aspectRatio: String(aspectRatio),
          maxWidth: `${previewMaxWidth}px`,
          maxHeight: `${MAX_MEDIA_PREVIEW_HEIGHT}px`,
        }}
        onMouseDown={(e) => { dragging.current = true; getFocalFromEvent(e); }}
        onMouseMove={(e) => { if (dragging.current) getFocalFromEvent(e); }}
        onMouseUp={() => { dragging.current = false; }}
        onMouseLeave={() => { dragging.current = false; }}
      >
        <video
          src={videoUrl}
          muted
          loop
          autoPlay
          playsInline
          className="absolute inset-0 w-full h-full object-cover pointer-events-none"
          style={{ objectPosition: `${fp.x * 100}% ${fp.y * 100}%` }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent pointer-events-none" />
        <div
          className="absolute pointer-events-none"
          style={{
            left: `${fp.x * 100}%`,
            top: `${fp.y * 100}%`,
            transform: "translate(-50%, -50%)",
          }}
        >
          <div className="w-7 h-7 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.3)] flex items-center justify-center">
            <div className="w-1.5 h-1.5 rounded-full bg-white" />
          </div>
        </div>
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/50 text-white text-[10px] px-2 py-0.5 rounded-full pointer-events-none whitespace-nowrap">
          Cliquez ou glissez pour définir le cadrage
        </div>
      </div>
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-muted-foreground">
          Cadrage : {Math.round(fp.x * 100)}% / {Math.round(fp.y * 100)}%
        </p>
        <label className="text-xs text-info-700 hover:text-info-700 cursor-pointer hover:underline">
          Changer la vidéo
          <input
            type="file"
            accept="video/mp4,video/quicktime,video/x-m4v,video/webm"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])}
          />
        </label>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// AudioFieldInput — audio file picker + lecteur HTML5
// ─────────────────────────────────────────────────────────────────────────

export function AudioFieldInput({
  value,
  onUpload,
  uploadProgress,
}: {
  value: unknown;
  onUpload: (f: File) => void;
  uploadProgress?: number | null;
}) {
  const audioUrl = typeof value === "string" && value ? value : null;

  if (uploadProgress !== null && uploadProgress !== undefined) {
    return (
      <div className="w-full h-24 border-2 border-dashed border-info-200 rounded-xl flex flex-col items-center justify-center gap-3 bg-info-50 px-6">
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-info-200 h-2 rounded-full transition-all duration-300"
            style={{ width: `${uploadProgress}%` }}
          />
        </div>
        <p className="text-xs text-info-700 font-medium">Upload en cours… {uploadProgress}%</p>
      </div>
    );
  }

  if (!audioUrl) {
    return (
      <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-border rounded-xl cursor-pointer hover:border-info-200 hover:bg-info-50 transition-colors group">
        <span className="text-2xl text-muted-foreground/60 group-hover:text-info-600 transition-colors">♪</span>
        <span className="text-sm font-medium text-muted-foreground group-hover:text-info-700 mt-1">Cliquer pour choisir un fichier audio</span>
        <span className="text-xs text-muted-foreground/60 mt-0.5">MP3 · WAV · AAC · M4A · OGG</span>
        <input
          type="file"
          accept="audio/mpeg,audio/wav,audio/aac,audio/mp4,audio/ogg,audio/x-m4a,.mp3,.wav,.aac,.m4a,.ogg"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])}
        />
      </label>
    );
  }

  return (
    <div className="space-y-2">
      <audio src={audioUrl} controls className="w-full" />
      <div className="flex items-center justify-end">
        <label className="text-xs text-info-700 hover:text-info-700 cursor-pointer hover:underline">
          Changer le fichier audio
          <input
            type="file"
            accept="audio/mpeg,audio/wav,audio/aac,audio/mp4,audio/ogg,audio/x-m4a,.mp3,.wav,.aac,.m4a,.ogg"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])}
          />
        </label>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// FieldInput — orchestrateur qui choisit le bon sous-composant selon
// field.type. Le wrapper externe (label + badges optionnel/conditionnel
// /from-library/from-asset + helper text + error) reste ici.
// ─────────────────────────────────────────────────────────────────────────

export function FieldInput({
  field,
  value,
  previewAspectRatio,
  focalPoint,
  error,
  uploadProgress,
  onChange,
  onUpload,
  onFocalChange,
  fromLibrary,
  fromAsset,
}: {
  field: SchemaField;
  value: unknown;
  previewAspectRatio?: number;
  focalPoint?: { x: number; y: number } | null;
  error?: string;
  uploadProgress?: number | null;
  onChange: (v: unknown) => void;
  onUpload: (f: File) => void;
  onFocalChange?: (fp: { x: number; y: number }) => void;
  fromLibrary?: boolean;
  fromAsset?: boolean;
}) {
  const isConditional = Boolean(field.showIf);
  const helperText = field.description || (isConditional
    ? `Affiché après le choix ${field.showIf?.field} = ${field.showIf?.equals}`
    : "");
  const controlClassName = "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-info-200";

  return (
    <div>
      <div className="min-h-[28px] mb-1.5 flex items-center gap-2 flex-wrap">
        <label className="block text-sm font-medium text-foreground">
          {field.label || field.key}
          {field.required && <span className="text-red-500 ml-1">*</span>}
        </label>
        {!field.required && !isConditional && (
          <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            optionnel
          </span>
        )}
        {isConditional && (
          <span className="inline-flex items-center gap-1 rounded-full border border-warning-200 bg-warning-50 px-2 py-0.5 text-[10px] font-medium text-warning-700">
            <span className="h-1.5 w-1.5 rounded-full bg-warning-600" />
            conditionnel
          </span>
        )}
        {fromLibrary && (
          <span className="inline-flex items-center gap-1 rounded-full border border-info-200 bg-info-50 px-2 py-0.5 text-[10px] font-medium text-info-700">
            <span className="h-1.5 w-1.5 rounded-full bg-info-200" />
            depuis la bibliothèque
          </span>
        )}
        {fromAsset && (
          <span className="inline-flex items-center gap-1 rounded-full border border-info-200 bg-info-50 px-2 py-0.5 text-[10px] font-medium text-info-700">
            <span className="h-1.5 w-1.5 rounded-full bg-info-200" />
            depuis l&apos;asset
          </span>
        )}
      </div>

      {field.type === "image" ? (
        <ImageFieldInput
          value={value}
          previewAspectRatio={previewAspectRatio}
          focalPoint={focalPoint ?? null}
          onUpload={onUpload}
          onFocalChange={onFocalChange ?? (() => {})}
          uploadProgress={uploadProgress}
        />
      ) : field.type === "video" ? (
        <VideoFieldInput
          value={value}
          previewAspectRatio={previewAspectRatio}
          focalPoint={focalPoint ?? null}
          onUpload={onUpload}
          onFocalChange={onFocalChange ?? (() => {})}
          uploadProgress={uploadProgress}
        />
      ) : field.type === "audio" ? (
        <AudioFieldInput
          value={value}
          onUpload={onUpload}
          uploadProgress={uploadProgress}
        />
      ) : field.type === "select" ? (
        <SelectFieldInput field={field} value={String(value ?? "")} onChange={onChange} controlClassName={controlClassName} />
      ) : field.type === "boolean" ? (
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
            className="rounded"
          />
          <span className="text-sm text-muted-foreground">Oui</span>
        </label>
      ) : field.type === "textarea" ? (
        <textarea
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          rows={4}
          className={controlClassName}
        />
      ) : field.type === "number" ? (
        <input
          type="text"
          inputMode="decimal"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          className={controlClassName}
        />
      ) : field.type === "url" ? (
        <input
          type="url"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder ?? "https://…"}
          className={controlClassName}
        />
      ) : (
        <input
          type="text"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          className={controlClassName}
        />
      )}

      <div className="mt-1.5 min-h-[16px]">
        {helperText ? (
          <p className="text-xs text-muted-foreground">{helperText}</p>
        ) : null}
      </div>

      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
}
