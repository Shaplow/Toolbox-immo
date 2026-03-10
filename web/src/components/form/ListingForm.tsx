"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { SchemaField } from "@/types/template";

interface Props {
  templateId: string;
  schema: SchemaField[];
  initialValues?: Record<string, unknown>;
}

type Variant = {
  id: string;
  num: number;
  status: "polling" | "done" | "error";
  imageUrl?: string;
  pdfUrl?: string;
  videoUrl?: string; // render vidéo (pipeline RunPod)
  errorMsg?: string;
};

export function ListingForm({ templateId, schema, initialValues }: Props) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(schema.map((f) => [f.key, initialValues?.[f.key] ?? f.default ?? ""]))
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitErrors, setSubmitErrors] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number | null>>({});
  const [variants, setVariants] = useState<Variant[]>([]);
  const variantCountRef = useRef(0);
  const pollTimers = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  // Reuse the same listingId for all generates in this session (variants on the same listing)
  const listingIdRef = useRef<string | null>(null);

  function handleChange(key: string, value: unknown) {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => { const next = { ...e }; delete next[key]; return next; });
  }

  async function handleUpload(key: string, file: File) {
    await new Promise<void>((resolve) => {
      const fd = new FormData();
      fd.append("file", file);
      const xhr = new XMLHttpRequest();
      setUploadProgress((p) => ({ ...p, [key]: 0 }));
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          setUploadProgress((p) => ({ ...p, [key]: Math.round((e.loaded / e.total) * 100) }));
        }
      };
      xhr.onload = () => {
        setUploadProgress((p) => ({ ...p, [key]: null }));
        try {
          const data = JSON.parse(xhr.responseText) as { url?: string; error?: string };
          if (data.url) handleChange(key, data.url);
          else setSubmitErrors([data.error ?? "Erreur upload"]);
        } catch {
          setSubmitErrors(["Erreur upload : réponse invalide"]);
        }
        resolve();
      };
      xhr.onerror = () => {
        setUploadProgress((p) => ({ ...p, [key]: null }));
        setSubmitErrors(["Erreur upload réseau"]);
        resolve();
      };
      xhr.open("POST", "/api/upload");
      xhr.send(fd);
    });
  }

  const startPolling = useCallback((renderId: string) => {
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/renders/${renderId}`);
        const data = await res.json() as { status: string; pngUrl?: string; pdfUrl?: string; videoUrl?: string; errorMsg?: string };
        if (data.status === "DONE" || data.status === "ERROR") {
          clearInterval(timer);
          pollTimers.current.delete(renderId);
          setVariants((prev) => prev.map((v) =>
            v.id === renderId
              ? { ...v, status: data.status === "DONE" ? "done" : "error", imageUrl: data.pngUrl, pdfUrl: data.pdfUrl, videoUrl: data.videoUrl, errorMsg: data.errorMsg ?? undefined }
              : v
          ));
        }
      } catch {
        clearInterval(timer);
        pollTimers.current.delete(renderId);
        setVariants((prev) => prev.map((v) => v.id === renderId ? { ...v, status: "error" } : v));
      }
    }, 2000);
    pollTimers.current.set(renderId, timer);
  }, []);

  /** Returns true if a field's showIf condition is satisfied (or absent) */
  function isFieldVisible(field: SchemaField): boolean {
    if (!field.showIf) return true;
    const actual = String(values[field.showIf.field] ?? "");
    return actual === field.showIf.equals;
  }

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitErrors([]);

    // Validation — skip hidden fields
    const newErrors: Record<string, string> = {};
    for (const field of schema) {
      if (!field.required) continue;
      if (!isFieldVisible(field)) continue; // hidden = not required
      const val = values[field.key];
      if (val === undefined || val === null || val === "") {
        newErrors[field.key] = `${field.label || field.key} est obligatoire`;
      }
    }
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      setSubmitErrors(Object.values(newErrors));
      return;
    }

    setGenerating(true);
    try {
      let listingId = listingIdRef.current;

      if (!listingId) {
        // First generate: create a new listing
        const listingRes = await fetch("/api/listings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ templateId, data: values }),
        });
        if (!listingRes.ok && listingRes.headers.get("content-type")?.includes("text/html")) {
          setSubmitErrors([`Erreur serveur ${listingRes.status} — voir la console Next.js`]);
          return;
        }
        const listing = await listingRes.json() as { id?: string; error?: string; missing?: string[] };
        if (!listing.id) {
          const msg = listing.missing
            ? `Champs manquants : ${listing.missing.join(", ")}`
            : (listing.error ?? "Erreur lors de la création du listing.");
          setSubmitErrors([msg]);
          return;
        }
        listingId = listing.id;
        listingIdRef.current = listingId;
      } else {
        // Subsequent generates: update the existing listing with current form data
        await fetch(`/api/listings/${listingId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: values }),
        });
      }

      const renderRes = await fetch("/api/renders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId, listingId }),
      });
      const render = await renderRes.json() as { id?: string };
      if (!render.id) { setSubmitErrors(["Erreur lors du lancement de la génération."]); return; }

      variantCountRef.current += 1;
      const newVariant: Variant = { id: render.id, num: variantCountRef.current, status: "polling" };
      setVariants((prev) => [newVariant, ...prev]);
      startPolling(render.id);
    } finally {
      setGenerating(false);
    }
  }

  const doneVariants = variants.filter((v) => v.status === "done");

  return (
    <div className="flex gap-6 items-start">
      {/* ── Form ─────────────────────────────────────────────────────────── */}
      <form onSubmit={handleGenerate} className="flex-1 space-y-6 min-w-0">
        {submitErrors.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4">
            <p className="text-sm font-medium text-red-700 mb-2">Champs obligatoires manquants :</p>
            <ul className="list-disc list-inside space-y-1">
              {submitErrors.map((e) => (
                <li key={e} className="text-sm text-red-600">{e}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
          {schema.map((field) => {
            if (!isFieldVisible(field)) return null;
            return (
              <FieldInput
                key={field.key}
                field={field}
                value={values[field.key]}
                focalPoint={(field.type === "image" || field.type === "video") ? (values[field.key + "_focalpoint"] as { x: number; y: number } | null) ?? null : null}
                error={errors[field.key]}
                uploadProgress={uploadProgress[field.key] ?? null}
                onChange={(v) => handleChange(field.key, v)}
                onUpload={(f) => handleUpload(field.key, f)}
                onFocalChange={(fp) => handleChange(field.key + "_focalpoint", fp)}
              />
            );
          })}
        </div>

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
          >
            ← Retour
          </button>
          <button
            type="submit"
            disabled={generating}
            className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium disabled:opacity-60 transition-colors"
          >
            {generating ? "Génération…" : variants.length === 0 ? "Générer" : "Générer une variante"}
          </button>
        </div>
      </form>

      {/* ── Variants panel ───────────────────────────────────────────────── */}
      <div className="w-80 shrink-0 sticky top-6 space-y-3">
        {/* Header with link to listings */}
        {doneVariants.length > 0 && (
          <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-2.5 flex items-center justify-between">
            <p className="text-xs font-medium text-indigo-800">{doneVariants.length} variante{doneVariants.length > 1 ? "s" : ""} générée{doneVariants.length > 1 ? "s" : ""}</p>
            <a
              href="/listings"
              className="text-xs text-indigo-700 hover:underline font-medium"
            >
              Mes listings →
            </a>
          </div>
        )}

        {variants.length === 0 && (
          <div className="bg-white rounded-xl border border-gray-100 p-6 flex flex-col items-center justify-center gap-2 text-gray-300">
            <span className="text-4xl">▦</span>
            <p className="text-xs text-center">Remplissez le formulaire<br />et cliquez sur Générer</p>
          </div>
        )}

        {variants.map((v) => (
          <div key={v.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="px-3 py-2 border-b border-gray-50 flex items-center justify-between">
              <p className="text-xs font-medium text-gray-700">Variante {v.num}</p>
              {v.status === "done" && (
                <a href={`/renders/${v.id}`} className="text-[10px] text-indigo-700 hover:underline">
                  Voir en plein écran →
                </a>
              )}
            </div>

            {v.status === "polling" && (
              <div className="h-36 flex flex-col items-center justify-center gap-3 text-gray-400">
                <div className="w-7 h-7 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                <p className="text-xs">Génération en cours…</p>
              </div>
            )}

            {v.status === "error" && (
              <div className="flex flex-col items-center justify-center gap-2 text-red-400 p-4">
                <span className="text-2xl">⚠</span>
                <p className="text-xs text-center font-medium">Erreur de génération</p>
                {v.errorMsg && (
                  <p className="text-[10px] text-red-500 text-center bg-red-50 rounded-lg p-2 w-full break-words">{v.errorMsg}</p>
                )}
              </div>
            )}

            {v.status === "done" && (v.imageUrl || v.videoUrl) && (
              <div className="p-3 space-y-2">
                {/* Rendu vidéo */}
                {v.videoUrl && (
                  <video
                    src={v.videoUrl}
                    controls
                    className="w-full rounded-lg border border-gray-100 shadow-sm"
                    style={{ maxHeight: 220 }}
                  />
                )}
                {/* Rendu image */}
                {!v.videoUrl && v.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={v.imageUrl}
                    alt={`Variante ${v.num}`}
                    className="w-full rounded-lg border border-gray-100 shadow-sm"
                  />
                )}
                <div className="flex gap-1.5">
                  {v.videoUrl && (
                    <a
                      href={v.videoUrl}
                      download
                      className="flex-1 text-center text-xs py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg"
                    >
                      ↓ MP4
                    </a>
                  )}
                  {!v.videoUrl && v.imageUrl && (
                    <a
                      href={v.imageUrl}
                      download
                      className="flex-1 text-center text-xs py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50"
                    >
                      ↓ PNG
                    </a>
                  )}
                  {v.pdfUrl && (
                    <a
                      href={v.pdfUrl}
                      download
                      className="flex-1 text-center text-xs py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg"
                    >
                      ↓ PDF
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function FieldInput({
  field,
  value,
  focalPoint,
  error,
  uploadProgress,
  onChange,
  onUpload,
  onFocalChange,
}: {
  field: SchemaField;
  value: unknown;
  focalPoint?: { x: number; y: number } | null;
  error?: string;
  uploadProgress?: number | null;
  onChange: (v: unknown) => void;
  onUpload: (f: File) => void;
  onFocalChange?: (fp: { x: number; y: number }) => void;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {field.label || field.key}
        {field.required && <span className="text-red-500 ml-1">*</span>}
      </label>
      {field.description && (
        <p className="text-xs text-gray-400 mb-1.5">{field.description}</p>
      )}

      {field.type === "image" ? (
        <ImageFieldInput
          value={value}
          focalPoint={focalPoint ?? null}
          onUpload={onUpload}
          onFocalChange={onFocalChange ?? (() => {})}
          uploadProgress={uploadProgress}
        />
      ) : field.type === "video" ? (
        <VideoFieldInput
          value={value}
          focalPoint={focalPoint ?? null}
          onUpload={onUpload}
          onFocalChange={onFocalChange ?? (() => {})}
          uploadProgress={uploadProgress}
        />
      ) : field.type === "select" ? (
        <select
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
        >
          <option value="">—</option>
          {field.options?.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      ) : field.type === "boolean" ? (
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
            className="rounded"
          />
          <span className="text-sm text-gray-600">Oui</span>
        </label>
      ) : field.type === "number" ? (
        <input
          type="number"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
          placeholder={field.placeholder}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
        />
      ) : field.type === "url" ? (
        <input
          type="url"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder ?? "https://…"}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
        />
      ) : (
        <input
          type="text"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
        />
      )}

      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
}

function ImageFieldInput({
  value,
  focalPoint,
  onUpload,
  onFocalChange,
  uploadProgress,
}: {
  value: unknown;
  focalPoint: { x: number; y: number } | null;
  onUpload: (f: File) => void;
  onFocalChange: (fp: { x: number; y: number }) => void;
  uploadProgress?: number | null;
}) {
  const imageUrl = typeof value === "string" && value ? value : null;
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const fp = focalPoint ?? { x: 0.5, y: 0.5 };

  // Upload en cours
  if (uploadProgress !== null && uploadProgress !== undefined) {
    return (
      <div className="w-full h-32 border-2 border-dashed border-indigo-300 rounded-xl flex flex-col items-center justify-center gap-3 bg-indigo-50 px-6">
        <div className="w-full bg-gray-200 rounded-full h-1.5">
          <div
            className="bg-indigo-400 h-1.5 rounded-full transition-all duration-300"
            style={{ width: `${uploadProgress}%` }}
          />
        </div>
        <p className="text-xs text-indigo-700 font-medium">Upload… {uploadProgress}%</p>
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
      <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-gray-200 rounded-xl cursor-pointer hover:border-indigo-400 hover:bg-indigo-50 transition-colors group">
        <span className="text-2xl text-gray-300 group-hover:text-indigo-400 transition-colors">↑</span>
        <span className="text-sm font-medium text-gray-400 group-hover:text-indigo-700 mt-1">Cliquer pour choisir une image</span>
        <span className="text-xs text-gray-300 mt-0.5">JPG · PNG · WEBP</span>
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
      {/* Image preview with focal point picker */}
      <div
        ref={containerRef}
        className="relative w-full rounded-xl overflow-hidden cursor-crosshair border border-gray-200 select-none"
        style={{ paddingBottom: "56.25%" }}
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
        {/* Dark vignette overlay hint */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent pointer-events-none" />
        {/* Crosshair dot */}
        <div
          className="absolute pointer-events-none"
          style={{
            left: `${fp.x * 100}%`,
            top: `${fp.y * 100}%`,
            transform: "translate(-50%, -50%)",
          }}
        >
          {/* Outer ring */}
          <div className="w-7 h-7 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.3)] flex items-center justify-center">
            {/* Inner dot */}
            <div className="w-1.5 h-1.5 rounded-full bg-white" />
          </div>
        </div>
        {/* Instruction badge */}
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/50 text-white text-[10px] px-2 py-0.5 rounded-full pointer-events-none whitespace-nowrap">
          Cliquez ou glissez pour définir le point focal
        </div>
      </div>
      {/* Footer */}
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-gray-400">
          Point focal : {Math.round(fp.x * 100)}% / {Math.round(fp.y * 100)}%
        </p>
        <label className="text-xs text-indigo-700 hover:text-indigo-700 cursor-pointer hover:underline">
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

function VideoFieldInput({
  value,
  focalPoint,
  onUpload,
  onFocalChange,
  uploadProgress,
}: {
  value: unknown;
  focalPoint: { x: number; y: number } | null;
  onUpload: (f: File) => void;
  onFocalChange: (fp: { x: number; y: number }) => void;
  uploadProgress?: number | null;
}) {
  const videoUrl = typeof value === "string" && value ? value : null;
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const fp = focalPoint ?? { x: 0.5, y: 0.5 };

  function getFocalFromEvent(e: React.MouseEvent | MouseEvent) {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    onFocalChange({ x, y });
  }

  // Upload en cours
  if (uploadProgress !== null && uploadProgress !== undefined) {
    return (
      <div className="w-full h-32 border-2 border-dashed border-indigo-300 rounded-xl flex flex-col items-center justify-center gap-3 bg-indigo-50 px-6">
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-indigo-400 h-2 rounded-full transition-all duration-300"
            style={{ width: `${uploadProgress}%` }}
          />
        </div>
        <p className="text-xs text-indigo-700 font-medium">Upload en cours… {uploadProgress}%</p>
      </div>
    );
  }

  if (!videoUrl) {
    return (
      <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-gray-200 rounded-xl cursor-pointer hover:border-indigo-400 hover:bg-indigo-50 transition-colors group">
        <span className="text-2xl text-gray-300 group-hover:text-indigo-400 transition-colors">🎬</span>
        <span className="text-sm font-medium text-gray-400 group-hover:text-indigo-700 mt-1">Cliquer pour choisir une vidéo</span>
        <span className="text-xs text-gray-300 mt-0.5">MP4 · MOV · WEBM — max 500 MB</span>
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
      {/* Preview vidéo avec overlay cadrage — muted/loop, pas de controls pour le drag */}
      <div
        ref={containerRef}
        className="relative w-full rounded-xl overflow-hidden cursor-crosshair border border-gray-200 select-none"
        style={{ paddingBottom: "56.25%" }}
        onMouseDown={(e) => { dragging.current = true; getFocalFromEvent(e); }}
        onMouseMove={(e) => { if (dragging.current) getFocalFromEvent(e); }}
        onMouseUp={() => { dragging.current = false; }}
        onMouseLeave={() => { dragging.current = false; }}
      >
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
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
        {/* Crosshair */}
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
        <p className="text-[10px] text-gray-400">
          Cadrage : {Math.round(fp.x * 100)}% / {Math.round(fp.y * 100)}%
        </p>
        <label className="text-xs text-indigo-700 hover:text-indigo-700 cursor-pointer hover:underline">
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
