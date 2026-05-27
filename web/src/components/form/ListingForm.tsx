"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { UNSECTIONED_FORM_SECTION_ID, computeSectionFieldStyles, getFieldPlacementClass, getFieldSpanClass, getFormSectionGridClass, getFormSectionSpanClass, getSectionFieldsInVisualOrder, buildVisibleFormSections } from "@/lib/formSections";
import type { SchemaField, TemplateFormSection } from "@/types/template";
import type { LibraryPrefillContext, LibraryAssetOption, MetadataDrivenLink } from "@/types/libraryPrefill";
import { LibraryFieldInput } from "@/components/form/LibraryPicker";
import { FieldInput } from "@/components/form/FieldInputs";
import { toast } from "@/components/ui/Toast";
import type { JobEventPayload } from "@/lib/sseStore";

interface Props {
  templateId: string;
  /** ID effectif de l'utilisateur — utilisé pour scoper le draft localStorage afin
   *  d'éviter le partage de brouillons entre comptes sur un poste partagé. */
  currentUserId: string;
  schema: SchemaField[];
  formSections: TemplateFormSection[];
  mediaFieldAspectRatios?: Record<string, number>;
  initialValues?: Record<string, unknown>;
  libraryPrefillContext?: LibraryPrefillContext;
  /** Quand true, la génération se lance automatiquement au montage sans afficher le formulaire. */
  autoSubmit?: boolean;
}

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
): { videoAssets?: Record<string, string>; audioAssetId?: string; dataEntryId?: string; setSequencedLibraryIds?: string[]; usedSetTagByLibrary?: Record<string, string>; usedCategoryByLibrary?: Record<string, string>; prevDataEntryState?: { entryId: string; campaignId: string; usagePolicy: string; claimType: "usedInCycle" | "perAccountUsage"; accountId?: string } } | undefined {
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
    prevDataEntryState: ctx.prevDataEntryState ?? undefined,
  };
}

export function ListingForm({ templateId, currentUserId, schema, formSections, mediaFieldAspectRatios = {}, initialValues, libraryPrefillContext, autoSubmit }: Props) {
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

    // Dynamic metadata-driven video resolution:
    // When a select field linked to a metadata-values-from-library slot changes,
    // fetch the matching video asset and auto-populate the linked video field.
    const metadataDrivenLinks: MetadataDrivenLink[] = libraryPrefillContext?.metadataDrivenLinks ?? [];
    const matchingLinks = metadataDrivenLinks.filter((l) => l.sourceFieldKey === key);
    for (const link of matchingLinks) {
      if (typeof value === "string" && value.trim()) {
        try {
          const params = new URLSearchParams({
            libraryId: link.libraryId,
            metadataKey: link.metadataKey,
            value: value.trim(),
            ...(libraryPrefillContext?.selectedAccountId ? { accountId: libraryPrefillContext.selectedAccountId } : {}),
          });
          const res = await fetch(`/api/library/resolve-by-metadata?${params}`);
          if (res.ok) {
            const asset = await res.json() as { id: string; url: string; filename: string; metadata?: Record<string, string | number | null> } | null;
            if (asset) {
              setLibrarySelections((prev) => ({ ...prev, [link.targetFieldKey]: asset }));
              setValues((prev) => {
                const patch: Record<string, unknown> = { [link.targetFieldKey]: asset.url };
                // Also populate schema fields with metadataSource pointing at this library
                // (e.g. adre, surface fields in the intro) — only if currently empty.
                if (asset.metadata) {
                  for (const schemaField of schema) {
                    if (schemaField.metadataSource?.libraryId !== link.libraryId) continue;
                    const metaValue = asset.metadata[schemaField.metadataSource.metadataKey];
                    if (metaValue === null || metaValue === undefined) continue;
                    const existing = prev[schemaField.key];
                    if (existing !== undefined && existing !== null && existing !== "") continue;
                    patch[schemaField.key] = String(metaValue);
                  }
                }
                return { ...prev, ...patch };
              });
            }
          }
        } catch { /* non-critical — user can still select manually */ }
      } else {
        // Source field cleared — clear the linked video too
        setLibrarySelections((prev) => ({ ...prev, [link.targetFieldKey]: null }));
        setValues((prev) => ({ ...prev, [link.targetFieldKey]: "" }));
      }
    }
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

  // Auto-save brouillon localStorage. Évite la perte de saisie quand l'user
  // ferme l'onglet par inadvertance avant de générer. On stocke uniquement
  // les valeurs texte/select remplies — pas les fichiers en upload.
  // Skip en mode régénération (initialValues fourni par le serveur).
  // Scoped par userId pour ne pas partager les brouillons entre comptes sur
  // un poste partagé (R7-fix audit post-merge 2026-05-27).
  const draftKey = `listingDraft:${currentUserId}:${templateId}`;
  const skipDraftRef = useRef(!!initialValues);

  useEffect(() => {
    if (typeof window === "undefined" || skipDraftRef.current) return;
    try {
      const saved = localStorage.getItem(draftKey);
      if (!saved) return;
      const parsed = JSON.parse(saved) as Record<string, unknown>;
      setValues((prev) => ({ ...prev, ...parsed }));
    } catch {
      // Silent : draft corrompu, on l'ignore.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || skipDraftRef.current) return;
    const handle = setTimeout(() => {
      try {
        const filled = Object.fromEntries(
          Object.entries(values).filter(([, v]) => isFilledValue(v) && typeof v !== "object"),
        );
        if (Object.keys(filled).length === 0) {
          localStorage.removeItem(draftKey);
        } else {
          localStorage.setItem(draftKey, JSON.stringify(filled));
        }
      } catch {
        // Silent : quota dépassé.
      }
    }, 500);
    return () => clearTimeout(handle);
  }, [values, draftKey]);

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
        // Listing créé → le draft est obsolète, on le purge.
        try {
          if (typeof window !== "undefined") localStorage.removeItem(draftKey);
        } catch {
          // Silent
        }
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
      // F2-step2 — feedback toast au submit success.
      // Sans toast l'user voit juste la card "polling" apparaître, mais
      // visuellement c'est subtil et le feedback était implicite.
      toast.success(
        variantCountRef.current === 1
          ? "Render lancé — suivi en cours"
          : `Variante n°${variantCountRef.current} lancée`,
      );
    } finally {
      setGenerating(false);
    }
  }

  // F2-step2 — beforeunload guard : avertir avant de quitter la page si
  // des changements non sauvegardés sont en cours. On compare values vs
  // initialValues + on ignore quand generating (le polling continue ok)
  // ou quand variants existent déjà (succès → l'user peut quitter).
  useEffect(() => {
    const hasUserChanges = JSON.stringify(values) !== JSON.stringify(initialValues ?? {});
    if (!hasUserChanges || generating || variants.length > 0) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [values, initialValues, generating, variants.length]);

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
                <option key={a.id} value={a.id}>@{a.handle} · {a.name}</option>
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
                      accountId={libraryPrefillContext.selectedAccountId ?? undefined}
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
                      fromAsset={Boolean(field.metadataSource?.metadataKey)}
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
