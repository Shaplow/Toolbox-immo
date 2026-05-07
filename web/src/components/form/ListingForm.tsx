"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { UNSECTIONED_FORM_SECTION_ID, computeSectionFieldStyles, getFieldPlacementClass, getFieldSpanClass, getFormSectionGridClass, getFormSectionSpanClass, getSectionFieldsInVisualOrder, buildVisibleFormSections } from "@/lib/formSections";
import type { SchemaField, TemplateFormSection } from "@/types/template";
import type { LibraryPrefillContext, LibraryAssetOption } from "@/types/libraryPrefill";
import { LibraryFieldInput } from "@/components/form/LibraryPicker";
import type { JobEventPayload } from "@/lib/sseStore";

interface Props {
  templateId: string;
  schema: SchemaField[];
  formSections: TemplateFormSection[];
  mediaFieldAspectRatios?: Record<string, number>;
  initialValues?: Record<string, unknown>;
  libraryPrefillContext?: LibraryPrefillContext;
  /** Quand true, la génération se lance automatiquement au montage sans afficher le formulaire. */
  autoSubmit?: boolean;
}

const DEFAULT_MEDIA_PREVIEW_ASPECT_RATIO = 16 / 9;
const MAX_MEDIA_PREVIEW_HEIGHT = 420;

type Variant = {
  id: string;
  num: number;
  status: "polling" | "done" | "error";
  imageUrl?: string;
  videoUrl?: string; // render vidéo (pipeline RunPod)
  errorMsg?: string;
  stage?: string;
  statusDetail?: string;
  progress?: number | null;
};

function isFilledValue(value: unknown): boolean {
  return !(value === undefined || value === null || value === "");
}

function resolveInitialFieldValue(field: SchemaField, initialValue: unknown): unknown {
  if (initialValue !== undefined && initialValue !== null) return initialValue;
  if (field.default !== undefined && field.default !== null) return field.default;
  return "";
}

function buildUsedAssets(
  ctx: LibraryPrefillContext,
  selections: Record<string, LibraryAssetOption | null>,
): { videoAssets?: Record<string, string>; audioAssetId?: string; dataEntryId?: string; setSequencedLibraryIds?: string[]; usedSetTagByLibrary?: Record<string, string>; usedCategoryByLibrary?: Record<string, string>; prevCursorStateByLibrary?: Record<string, { prevCursor: number; claimedCursor: number; prevLastUsedCategory: string | null; claimedLastUsedCategory: string | null }>; prevDataEntryState?: { entryId: string; campaignId: string; usagePolicy: string; claimType: "usedInCycle" | "perAccountUsage"; accountId?: string } } | undefined {
  const fieldMap = ctx.fieldLibraryMap ?? {};
  const videoAssets: Record<string, string> = {};
  let audioAssetId: string | undefined;
  for (const [fieldKey, meta] of Object.entries(fieldMap)) {
    const sel = selections[fieldKey];
    if (!sel) continue;
    if (meta.type === "video") {
      videoAssets[meta.blockId] = sel.id;
    } else {
      audioAssetId = sel.id;
    }
  }
  const hasVideo = Object.keys(videoAssets).length > 0;
  const hasAny = hasVideo || audioAssetId || ctx.dataSuggestion?.entryId;
  if (!hasAny) return undefined;
  return {
    videoAssets: hasVideo ? videoAssets : undefined,
    audioAssetId,
    dataEntryId: ctx.dataSuggestion?.entryId,
    setSequencedLibraryIds: ctx.setSequencedLibraryIds?.length ? ctx.setSequencedLibraryIds : undefined,
    usedSetTagByLibrary: ctx.usedSetTagByLibrary && Object.keys(ctx.usedSetTagByLibrary).length > 0 ? ctx.usedSetTagByLibrary : undefined,
    usedCategoryByLibrary: ctx.usedCategoryByLibrary && Object.keys(ctx.usedCategoryByLibrary).length > 0 ? ctx.usedCategoryByLibrary : undefined,
    prevCursorStateByLibrary: ctx.prevCursorStateByLibrary && Object.keys(ctx.prevCursorStateByLibrary).length > 0 ? ctx.prevCursorStateByLibrary : undefined,
    prevDataEntryState: ctx.prevDataEntryState ?? undefined,
  };
}

export function ListingForm({ templateId, schema, formSections, mediaFieldAspectRatios = {}, initialValues, libraryPrefillContext, autoSubmit }: Props) {
  // Keys of data fields pre-filled from a DataEntry (drives badge display)
  const libraryPrefilledKeys = useMemo(
    () => new Set(libraryPrefillContext?.prefilledDataKeys ?? []),
    [libraryPrefillContext],
  );

  // Track which library asset is currently selected per field key
  const [librarySelections, setLibrarySelections] = useState<Record<string, LibraryAssetOption | null>>(
    () => Object.fromEntries(
      Object.entries(libraryPrefillContext?.initialSuggestions ?? {}).map(([k, v]) => [k, v]),
    ),
  );
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const autoSubmitFiredRef = useRef(false);
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(schema.map((field) => [field.key, resolveInitialFieldValue(field, initialValues?.[field.key])]))
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
  // SSE source — shared across all variants
  const sseSourceRef = useRef<EventSource | null>(null);

  // Resolve a variant to its terminal state (called from both poll and SSE paths)
  const resolveVariant = useCallback((renderId: string, data: {
    status: string;
    pngUrl?: string;
    videoUrl?: string;
    errorMsg?: string;
    stage?: string;
    statusDetail?: string;
    progress?: number | null;
  }) => {
    clearInterval(pollTimers.current.get(renderId));
    pollTimers.current.delete(renderId);
    setVariants((prev) => prev.map((v) =>
      v.id === renderId
        ? {
            ...v,
            status: data.status === "DONE" ? "done" : "error",
            imageUrl: data.pngUrl,
            videoUrl: data.videoUrl,
            errorMsg: data.errorMsg ?? undefined,
            stage: data.stage,
            statusDetail: data.statusDetail,
            progress: data.progress ?? null,
          }
        : v
    ));
    // Close SSE when all active polls are done
    if (pollTimers.current.size === 0) {
      sseSourceRef.current?.close();
      sseSourceRef.current = null;
    }
  }, []);

  const startPolling = useCallback((renderId: string) => {
    // Open SSE once for the whole session
    if (!sseSourceRef.current) {
      const source = new EventSource("/api/events/jobs");
      sseSourceRef.current = source;
      source.addEventListener("job", (e) => {
        try {
          const event = JSON.parse(e.data) as JobEventPayload;
          if (event.jobType !== "render") return;
          if (event.status === "DONE" || event.status === "ERROR") {
            const videoUrl = "videoUrl" in event ? (event.videoUrl as string | undefined) ?? undefined : undefined;
            const errorMsg = "errorMsg" in event ? (event.errorMsg as string | undefined) ?? undefined : undefined;
            resolveVariant(event.jobId, { status: event.status, videoUrl, errorMsg });
          }
        } catch { /* ignore parse errors */ }
      });
    }

    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/renders/${renderId}`);
        const data = await res.json() as {
          status: string;
          pngUrl?: string;
          videoUrl?: string;
          errorMsg?: string;
          stage?: string;
          statusDetail?: string;
          progress?: number | null;
        };
        setVariants((prev) => prev.map((v) =>
          v.id === renderId
            ? {
                ...v,
                stage: data.stage,
                statusDetail: data.statusDetail,
                progress: data.progress ?? null,
              }
            : v
        ));
        if (data.status === "DONE" || data.status === "ERROR") {
          resolveVariant(renderId, data);
        }
      } catch {
        clearInterval(pollTimers.current.get(renderId));
        pollTimers.current.delete(renderId);
        setVariants((prev) => prev.map((v) => v.id === renderId ? { ...v, status: "error" } : v));
      }
    }, 2000);
    pollTimers.current.set(renderId, timer);
  }, [resolveVariant]);

  async function handleChange(key: string, value: unknown) {
    if (value instanceof File) {
      const file = value;
      setUploadProgress((p) => ({ ...p, [key]: 0 }));

      // Étape 1 : obtenir l'URL pré-signée R2
      let uploadUrl: string;
      let publicUrl: string;
      try {
        const res = await fetch("/api/upload-presign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: file.name, contentType: file.type, size: file.size }),
        });
        const data = await res.json() as { uploadUrl?: string; publicUrl?: string; error?: string };
        if (!res.ok || !data.uploadUrl || !data.publicUrl) {
          setSubmitErrors([data.error ?? "Erreur préparation upload"]);
          setUploadProgress((p) => ({ ...p, [key]: null }));
          return;
        }
        uploadUrl = data.uploadUrl;
        publicUrl = data.publicUrl;
      } catch {
        setSubmitErrors(["Erreur réseau (presign)"]);
        setUploadProgress((p) => ({ ...p, [key]: null }));
        return;
      }

      // Étape 2 : PUT directement vers R2 avec suivi de progression
      await new Promise<void>((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            setUploadProgress((p) => ({ ...p, [key]: Math.round((e.loaded / e.total) * 100) }));
          }
        };
        xhr.onload = () => {
          setUploadProgress((p) => ({ ...p, [key]: null }));
          if (xhr.status >= 200 && xhr.status < 300) {
            handleChange(key, publicUrl);
          } else {
            setSubmitErrors([`Erreur upload R2 (${xhr.status})`]);
          }
          resolve();
        };
        xhr.onerror = () => {
          setUploadProgress((p) => ({ ...p, [key]: null }));
          setSubmitErrors(["Erreur upload réseau"]);
          resolve();
        };
        xhr.open("PUT", uploadUrl);
        xhr.setRequestHeader("Content-Type", file.type);
        xhr.send(file);
      });
      return;
    }

    setValues((prev) => ({ ...prev, [key]: value }));
  }

  const sections = useMemo(() => buildVisibleFormSections(schema, formSections, values), [formSections, schema, values]);
  const hasOnlyUnsectionedSection = sections.length === 1 && sections[0]?.id === UNSECTIONED_FORM_SECTION_ID;
  const visibleFields = useMemo(() => sections.flatMap((section) => section.fields), [sections]);
  const visibleFieldKeys = useMemo(() => new Set(visibleFields.map((field) => field.key)), [visibleFields]);
  const visibleRequiredFields = useMemo(
    () => visibleFields.filter((field) => field.required),
    [visibleFields]
  );
  const remainingRequiredFields = useMemo(
    () => visibleRequiredFields.filter((field) => !isFilledValue(values[field.key])),
    [values, visibleRequiredFields]
  );

  // Auto-submit on mount when autoSubmit=true
  useEffect(() => {
    if (autoSubmit && !autoSubmitFiredRef.current) {
      autoSubmitFiredRef.current = true;
      // Small delay so state settles before submitting
      const t = setTimeout(() => formRef.current?.requestSubmit(), 50);
      return () => clearTimeout(t);
    }
  }, [autoSubmit]);

  // Cleanup all intervals and SSE on unmount
  useEffect(() => {
    return () => {
      pollTimers.current.forEach((t) => clearInterval(t));
      sseSourceRef.current?.close();
    };
  }, []);

  useEffect(() => {
    setErrors((current) => {
      const nextEntries = Object.entries(current).filter(([key]) => visibleFieldKeys.has(key));
      if (nextEntries.length === Object.keys(current).length) return current;
      return Object.fromEntries(nextEntries);
    });
  }, [visibleFieldKeys]);

  function scrollToSection(sectionId: string) {
    const node = document.getElementById(`form-section-${sectionId}`);
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitErrors([]);

    // Validation — only require fields that are actually rendered now
    const newErrors: Record<string, string> = {};
    for (const field of visibleRequiredFields) {
      const val = values[field.key];
      if (val === undefined || val === null || val === "") {
        newErrors[field.key] = `${field.label || field.key} est obligatoire`;
      }
    }
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
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
        body: JSON.stringify({
          templateId,
          listingId,
          usedAssets: libraryPrefillContext ? buildUsedAssets(libraryPrefillContext, librarySelections) : undefined,
          accountId: libraryPrefillContext?.selectedAccountId ?? undefined,
          publicationSlotId: libraryPrefillContext?.slotId ?? undefined,
        }),
      });
      const renderContentType = renderRes.headers.get("content-type") ?? "";
      let render: { id?: string; error?: string } = {};
      if (renderContentType.includes("application/json")) {
        render = await renderRes.json() as { id?: string; error?: string };
      } else {
        const raw = await renderRes.text();
        render = raw ? { error: raw.slice(0, 300) } : { error: "Réponse vide du serveur" };
      }
      if (!renderRes.ok || !render.id) {
        setSubmitErrors([render.error ?? "Erreur lors du lancement de la génération."]);
        return;
      }

      variantCountRef.current += 1;
      const newVariant: Variant = {
        id: render.id,
        num: variantCountRef.current,
        status: "polling",
        stage: "QUEUED",
        statusDetail: "Job accepté",
        progress: 0.02,
      };
      setVariants((prev) => [newVariant, ...prev]);
      startPolling(render.id);
    } finally {
      setGenerating(false);
    }
  }

  const doneVariants = variants.filter((v) => v.status === "done");

  return (
    <div className="grid gap-6 md:grid-cols-4 items-start">
      {/* ── Form ─────────────────────────────────────────────────────────── */}
      {autoSubmit && variants.length === 0 && submitErrors.length === 0 ? (
        <div className="md:col-span-4 flex flex-col items-center justify-center gap-4 py-24">
          <div className="h-10 w-10 rounded-full border-4 border-indigo-600 border-t-transparent animate-spin" />
          <p className="text-sm text-gray-500">Génération automatique en cours…</p>
        </div>
      ) : autoSubmit && submitErrors.length > 0 ? (
        <div className="md:col-span-4 bg-red-50 border border-red-200 rounded-2xl p-6 space-y-2">
          {submitErrors.map((e) => (
            <p key={e} className="text-sm text-red-700">{e}</p>
          ))}
          <button
            type="button"
            onClick={() => { autoSubmitFiredRef.current = false; formRef.current?.requestSubmit(); }}
            className="mt-2 px-4 py-2 rounded-lg bg-red-600 text-white text-sm hover:bg-red-700"
          >
            Réessayer
          </button>
        </div>
      ) : null}
      <form ref={formRef} onSubmit={handleGenerate} className={`min-w-0 space-y-6 order-2 md:order-none md:col-span-3 ${autoSubmit ? "hidden" : ""}`}>
        {/* ── Instagram account selector (theme_sequence templates) ── */}
        {(libraryPrefillContext?.instagramAccounts?.length ?? 0) > 0 && (
          <div className="rounded-xl border border-pink-200 bg-pink-50 p-4 flex items-center gap-3">
            <span className="text-sm font-medium text-pink-800 shrink-0">Compte Instagram</span>
            <select
              value={libraryPrefillContext?.selectedAccountId ?? ""}
              onChange={(e) => {
                const id = e.target.value;
                const url = new URL(window.location.href);
                if (id) { url.searchParams.set("accountId", id); } else { url.searchParams.delete("accountId"); }
                router.push(url.toString());
              }}
              className="flex-1 rounded-lg border border-pink-200 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-pink-300"
            >
              <option value="">— Sélectionner un compte —</option>
              {libraryPrefillContext!.instagramAccounts!.map((a) => (
                <option key={a.id} value={a.id}>@{a.handle} · {a.name} ({a.offre})</option>
              ))}
            </select>
          </div>
        )}

        {submitErrors.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
            {submitErrors.map((e) => (
              <p key={e} className="text-sm text-red-700">{e}</p>
            ))}
          </div>
        )}

        {!hasOnlyUnsectionedSection ? <div className="xl:hidden -mx-1 overflow-x-auto pb-1">
          <div className="flex gap-2 px-1 min-w-max">
            {sections.map((section) => (
              <button
                key={section.id}
                type="button"
                onClick={() => scrollToSection(section.id)}
                className="px-3 py-1.5 rounded-full border border-gray-200 bg-white text-xs text-gray-600 hover:border-indigo-300 hover:text-indigo-700"
              >
                {section.title}
              </button>
            ))}
          </div>
        </div> : null}

        <div className="grid grid-cols-1 2xl:grid-cols-2 gap-5">
          {sections.map((section) => (
            <section
              key={section.id}
              id={`form-section-${section.id}`}
              className={`bg-white rounded-2xl border border-gray-100 p-5 md:p-6 shadow-sm scroll-mt-6 ${getFormSectionSpanClass(section)}`}
            >
            {!(hasOnlyUnsectionedSection && section.id === UNSECTIONED_FORM_SECTION_ID) ? (
              <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between mb-5">
                <div>
                  <p className="text-[11px] font-semibold tracking-[0.18em] uppercase text-gray-400">Section</p>
                  <h2 className="text-xl font-semibold text-gray-900 mt-1">{section.title}</h2>
                  {section.description ? <p className="text-sm text-gray-500 mt-2 max-w-2xl">{section.description}</p> : null}
                </div>
                <div className="text-xs text-gray-400">
                  {section.fields.filter((field) => field.required).length} requis · {section.fields.length} champs
                </div>
              </div>
            ) : null}

            <div className={getFormSectionGridClass(section)}>
              {(() => {
                const fieldStyles = computeSectionFieldStyles(section.fields, section.fieldColumns);
                return getSectionFieldsInVisualOrder(section.fields, section.fieldColumns).map((field) => (
                <div
                  key={field.key}
                  className={`${getFieldSpanClass(field, section.fieldColumns)} ${getFieldPlacementClass(field, section.fieldColumns)}`.trim()}
                  style={fieldStyles.get(field.key)}
                >
                  {libraryPrefillContext?.fieldLibraryMap[field.key] ? (
                    <LibraryFieldInput
                      field={field}
                      libraryMeta={libraryPrefillContext.fieldLibraryMap[field.key]}
                      currentSelection={librarySelections[field.key] ?? null}
                      onSelect={(asset) => {
                        setLibrarySelections((prev) => ({ ...prev, [field.key]: asset }));
                        handleChange(field.key, asset.url);
                      }}
                      error={errors[field.key]}
                      tagFilter={
                        libraryPrefillContext.fieldLibraryMap[field.key].tagFilterParam
                          ? String(values[libraryPrefillContext.fieldLibraryMap[field.key].tagFilterParam!] ?? "")
                          : undefined
                      }
                    />
                  ) : (
                    <FieldInput
                      field={field}
                      value={values[field.key]}
                      previewAspectRatio={mediaFieldAspectRatios[field.key]}
                      focalPoint={(field.type === "image" || field.type === "video") ? (values[field.key + "_focalpoint"] as { x: number; y: number } | null) ?? null : null}
                      error={errors[field.key]}
                      uploadProgress={uploadProgress[field.key] ?? null}
                      onChange={(v) => handleChange(field.key, v)}
                      onUpload={(f) => handleChange(field.key, f)}
                      onFocalChange={(fp) => handleChange(field.key + "_focalpoint", fp)}
                      fromLibrary={libraryPrefilledKeys.has(field.key)}
                    />
                  )}
                </div>
              ));
              })()}
            </div>
            </section>
          ))}
        </div>

        <div className="sticky bottom-4 z-10">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white/90 backdrop-blur rounded-2xl border border-gray-200 shadow-lg px-4 py-3">
          <div className="text-sm">
            {remainingRequiredFields.length > 0 ? (
              <p className="font-medium text-amber-700">
                {remainingRequiredFields.length} champ{remainingRequiredFields.length > 1 ? "s" : ""} obligatoire{remainingRequiredFields.length > 1 ? "s" : ""} restant{remainingRequiredFields.length > 1 ? "s" : ""}
              </p>
            ) : (
              <p className="font-medium text-emerald-700">Tous les champs obligatoires visibles sont remplis</p>
            )}
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
          </div>
        </div>
      </form>

      {/* ── Variants panel ───────────────────────────────────────────────── */}
      <div className={`w-full shrink-0 md:sticky md:top-6 space-y-3 order-1 md:order-none ${autoSubmit && variants.length > 0 ? "md:col-span-4" : "md:col-span-1"}`}>
        {!hasOnlyUnsectionedSection ? <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
          <p className="text-[11px] font-semibold tracking-[0.18em] uppercase text-gray-400 mb-3">Navigation</p>
          <div className="space-y-2">
            {sections.map((section) => {
              const requiredCount = section.fields.filter((field) => field.required).length;
              const filledCount = section.fields.filter((field) => !field.required || isFilledValue(values[field.key])).length;
              const sectionErrorCount = section.fields.filter((field) => errors[field.key]).length;
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => scrollToSection(section.id)}
                  className="w-full text-left px-3 py-2 rounded-xl border border-gray-100 hover:border-indigo-300 hover:bg-indigo-50 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-gray-700">{section.title}</span>
                    {sectionErrorCount > 0 ? (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-50 text-red-500">{sectionErrorCount} err.</span>
                    ) : (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">{filledCount}/{section.fields.length}</span>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-400 mt-1">{requiredCount > 0 ? `${requiredCount} champ${requiredCount > 1 ? "s" : ""} requis` : `${section.fields.length} champ${section.fields.length > 1 ? "s" : ""}`}</p>
                </button>
              );
            })}
          </div>
        </div> : null}

        {doneVariants.length > 0 && (
          <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-2.5 flex items-center justify-between">
            <p className="text-xs font-medium text-indigo-800">{doneVariants.length} variante{doneVariants.length > 1 ? "s" : ""} générée{doneVariants.length > 1 ? "s" : ""}</p>
            <a
              href="/listings"
              className="text-xs text-indigo-700 hover:underline font-medium"
            >
              Mes générations →
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
                <div className="space-y-1 text-center px-4">
                  <p className="text-xs">Génération en cours…</p>
                  {v.statusDetail && <p className="text-[10px] text-gray-500">{v.statusDetail}</p>}
                  {typeof v.progress === "number" && (
                    <p className="text-[10px] text-gray-400">{Math.round(v.progress * 100)}%</p>
                  )}
                </div>
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

                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Champ select avec support des options dynamiques (optionsSource). */
function SelectFieldInput({
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
    if (field.optionsSource?.type !== "ig-accounts-from-library") return;
    const libraryId = field.optionsSource.libraryId;
    fetch(`/api/admin/libraries/media/${libraryId}/ig-accounts`)
      .then((r) => r.ok ? r.json() : { accounts: [] })
      .then((data: { accounts: { handle: string; name: string }[] }) => {
        setDynamicOptions(data.accounts.map((a) => ({ value: a.handle, label: `${a.name} (@${a.handle})` })));
      })
      .catch(() => setDynamicOptions([]));
  }, [field.optionsSource?.type, field.optionsSource?.libraryId]);

  const options: { value: string; label: string }[] = dynamicOptions
    ?? (field.options ?? []).map((o) => ({ value: o, label: o }));

  const isLoading = field.optionsSource && dynamicOptions === null;

  return (
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
  );
}

function FieldInput({
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
}) {
  const isConditional = Boolean(field.showIf);
  const helperText = field.description || (isConditional
    ? `Affiché après le choix ${field.showIf?.field} = ${field.showIf?.equals}`
    : "");
  const controlClassName = "w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400";

  return (
    <div>
      <div className="min-h-[28px] mb-1.5 flex items-center gap-2 flex-wrap">
        <label className="block text-sm font-medium text-gray-700">
          {field.label || field.key}
          {field.required && <span className="text-red-500 ml-1">*</span>}
        </label>
        {isConditional && (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
            conditionnel
          </span>
        )}
        {fromLibrary && (
          <span className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-600">
            <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />
            depuis la bibliothèque
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
          <span className="text-sm text-gray-600">Oui</span>
        </label>
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
          <p className="text-xs text-gray-400">{helperText}</p>
        ) : null}
      </div>

      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
}

function ImageFieldInput({
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
        className="relative w-full rounded-xl overflow-hidden cursor-crosshair border border-gray-200 select-none mx-auto"
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
        <span className="text-xs text-gray-300 mt-0.5">MP4 · MOV · WEBM — max 2 Go</span>
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
        className="relative w-full rounded-xl overflow-hidden cursor-crosshair border border-gray-200 select-none mx-auto"
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

function AudioFieldInput({
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
      <div className="w-full h-24 border-2 border-dashed border-indigo-300 rounded-xl flex flex-col items-center justify-center gap-3 bg-indigo-50 px-6">
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

  if (!audioUrl) {
    return (
      <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-gray-200 rounded-xl cursor-pointer hover:border-indigo-400 hover:bg-indigo-50 transition-colors group">
        <span className="text-2xl text-gray-300 group-hover:text-indigo-400 transition-colors">♪</span>
        <span className="text-sm font-medium text-gray-400 group-hover:text-indigo-700 mt-1">Cliquer pour choisir un fichier audio</span>
        <span className="text-xs text-gray-300 mt-0.5">MP3 · WAV · AAC · M4A · OGG</span>
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
        <label className="text-xs text-indigo-700 hover:text-indigo-700 cursor-pointer hover:underline">
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
