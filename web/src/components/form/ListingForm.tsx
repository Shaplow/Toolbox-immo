"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { UNSECTIONED_FORM_SECTION_ID, computeSectionFieldStyles, getFieldPlacementClass, getFieldSpanClass, getFormSectionGridClass, getFormSectionSpanClass, getSectionFieldsInVisualOrder, buildVisibleFormSections } from "@/lib/formSections";
import type { SchemaField, TemplateFormSection } from "@/types/template";
import type { LibraryPrefillContext, LibraryAssetOption, MetadataDrivenLink } from "@/types/libraryPrefill";
import { LibraryFieldInput } from "@/components/form/LibraryPicker";
import { FieldInput } from "@/components/form/FieldInputs";
import { ListingFormVariantCard } from "@/components/form/ListingFormVariantCard";
import { toast } from "@/components/ui/Toast";
import { Alert } from "@/components/ui/Alert";
import { Select } from "@/components/ui/Select";
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
  /** Liste des comptes Instagram accessibles — toujours fournie si le template utilise une lib,
   *  permet de changer de compte après coup (ou de charger le prefill si templateNeedsAccount). */
  instagramAccounts?: Array<{ id: string; handle: string; name?: string | null }>;
  /** Vrai si le prefill SSR a été bloqué car le template utilise une lib et aucun accountId
   *  n'était connu. Le form doit bloquer le bouton Générer jusqu'à sélection + fetch. */
  templateNeedsAccount?: boolean;
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
): {
  videoAssets?: Record<string, string>;
  audioAssetId?: string;
  dataEntryId?: string;
  /** resolvedSetTag from the DataEntry group selection — drives AccountDataLibraryCursor advance. */
  dataResolvedSetTag?: string | null;
  /** resolvedCategory from the DataEntry group selection — drives AccountDataLibraryCursor advance. */
  dataResolvedCategory?: string | null;
  setSequencedLibraryIds?: string[];
  usedSetTagByLibrary?: Record<string, string>;
  usedCategoryByLibrary?: Record<string, string>;
  prevDataEntryState?: { entryId: string; campaignId: string; usagePolicy: string; claimType: "usedInCycle" | "perAccountUsage"; accountId?: string };
} | undefined {
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
    dataResolvedSetTag: ctx.dataSuggestion?.resolvedSetTag,
    dataResolvedCategory: ctx.dataSuggestion?.resolvedCategory,
    setSequencedLibraryIds: ctx.setSequencedLibraryIds?.length ? ctx.setSequencedLibraryIds : undefined,
    usedSetTagByLibrary: ctx.usedSetTagByLibrary && Object.keys(ctx.usedSetTagByLibrary).length > 0 ? ctx.usedSetTagByLibrary : undefined,
    usedCategoryByLibrary: ctx.usedCategoryByLibrary && Object.keys(ctx.usedCategoryByLibrary).length > 0 ? ctx.usedCategoryByLibrary : undefined,
    prevDataEntryState: ctx.prevDataEntryState ?? undefined,
  };
}

export function ListingForm({ templateId, currentUserId, schema, formSections, mediaFieldAspectRatios = {}, initialValues, libraryPrefillContext: initialLibraryPrefillContext, autoSubmit, instagramAccounts = [], templateNeedsAccount = false }: Props) {
  // Phase 2.3 : prefill contexte — peut être chargé côté client après sélection IG.
  const [libraryPrefillContext, setLibraryPrefillContext] = useState<LibraryPrefillContext | undefined>(
    initialLibraryPrefillContext,
  );
  const [selectedAccountId, setSelectedAccountId] = useState<string>(
    initialLibraryPrefillContext?.selectedAccountId ?? "",
  );
  const [prefillLoading, setPrefillLoading] = useState(false);

  // Keys of data fields pre-filled from a DataEntry (drives badge display)
  const libraryPrefilledKeys = useMemo(
    () => new Set(libraryPrefillContext?.prefilledDataKeys ?? []),
    [libraryPrefillContext],
  );

  // Track which library asset is currently selected per field key
  const [librarySelections, setLibrarySelections] = useState<Record<string, LibraryAssetOption | null>>(
    () => Object.fromEntries(
      Object.entries(initialLibraryPrefillContext?.initialSuggestions ?? {}).map(([k, v]) => [k, v]),
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

  // Phase 2.3 — charge le prefill depuis l'API après sélection d'un compte IG.
  async function handleAccountChange(accountId: string) {
    setSelectedAccountId(accountId);
    if (!accountId) return;
    setPrefillLoading(true);
    try {
      const res = await fetch(`/api/templates/${templateId}/prefill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId,
          // slotId/listingId ne sont pas connus côté client dans ce contexte
          // (la page les a déjà utilisés pour les champs — pas de double-fetch).
          slotId: null,
          listingId: null,
          initialValues: values,
        }),
      });
      if (res.ok) {
        const data = await res.json() as {
          context: LibraryPrefillContext | null;
          updatedInitialValues: Record<string, unknown>;
        };
        if (data.context) {
          setLibraryPrefillContext(data.context);
          // Injecter les suggestions dans les valeurs du form
          const newSuggestions = data.context.initialSuggestions ?? {};
          setLibrarySelections((prev) => ({ ...prev, ...newSuggestions }));
          setValues((prev) => {
            const patch: Record<string, unknown> = {};
            // 1) URLs médias depuis initialSuggestions.
            for (const [k, v] of Object.entries(newSuggestions)) {
              if (v?.url) patch[k] = v.url;
            }
            // 2) Champs data depuis updatedInitialValues, scopés aux clés
            //    réellement prefill par la DataEntry (évite d'écraser ce que
            //    l'user a tapé sur d'autres champs).
            for (const key of data.context?.prefilledDataKeys ?? []) {
              if (data.updatedInitialValues[key] !== undefined) {
                patch[key] = data.updatedInitialValues[key];
              }
            }
            return Object.keys(patch).length > 0 ? { ...prev, ...patch } : prev;
          });
        }
      } else {
        toast.error("Impossible de charger les suggestions pour ce compte.");
      }
    } catch {
      toast.error("Erreur réseau lors du chargement des suggestions.");
    } finally {
      setPrefillLoading(false);
    }
  }

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
          <div className="h-10 w-10 rounded-full border-4 border-peach-500 border-t-transparent animate-spin" />
          <p className="text-[13px] text-gray-500">Génération automatique en cours…</p>
        </div>
      ) : autoSubmit && submitErrors.length > 0 ? (
        <div className="md:col-span-4 rounded-2xl bg-gradient-to-b from-rose-50/85 to-rose-50/55 backdrop-blur-[10px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(201,113,133,0.32)] p-5 space-y-2">
          {submitErrors.map((e) => (
            <p key={e} className="text-[13px] text-rose-800">{e}</p>
          ))}
          <button
            type="button"
            onClick={() => { autoSubmitFiredRef.current = false; formRef.current?.requestSubmit(); }}
            className="mt-2 px-4 py-2 rounded-lg bg-gradient-to-b from-rose-600 to-rose-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_2px_4px_rgba(201,113,133,0.32)] text-white text-[13px] font-medium hover:from-rose-700 hover:to-rose-800 transition-all"
          >
            Réessayer
          </button>
        </div>
      ) : null}
      <form ref={formRef} onSubmit={handleGenerate} className={`min-w-0 space-y-6 order-2 md:order-none md:col-span-3 ${autoSubmit ? "hidden" : ""}`}>
        {/* ── Sélecteur compte Instagram (Phase 2.3) ─────────────────────────
            Cas 1 — templateNeedsAccount && !libraryPrefillContext :
              Prefill bloqué. Afficher Alert bloquant + Select compte.
            Cas 2 — instagramAccounts fournis ET prefill déjà chargé :
              Changer de compte recharge le prefill via POST (pas de reload page).
        ───────────────────────────────────────────────────────────────────── */}
        {templateNeedsAccount && !libraryPrefillContext && instagramAccounts.length > 0 && (
          <Alert
            variant="warning"
            title="Sélectionne d'abord un compte Instagram"
            className="mb-2 relative z-30"
          >
            <div className="mt-2 space-y-3">
              <p>Ce template utilise une bibliothèque de contenus. Choisis un compte pour charger les suggestions adaptées.</p>
              <Select
                value={selectedAccountId}
                onChange={handleAccountChange}
                placeholder="— Sélectionner un compte —"
                disabled={prefillLoading}
                options={instagramAccounts.map((a) => ({
                  value: a.id,
                  label: `@${a.handle}${a.name ? ` · ${a.name}` : ""}`,
                }))}
                variant="glass"
              />
              {prefillLoading && (
                <p className="text-[11.5px] text-peach-700 flex items-center gap-2">
                  <span className="inline-block h-3 w-3 rounded-full border-2 border-peach-500 border-t-transparent animate-spin" />
                  Chargement des suggestions…
                </p>
              )}
            </div>
          </Alert>
        )}
        {/* Sélecteur "changer de compte" : visible quand prefill déjà chargé */}
        {instagramAccounts.length > 0 && libraryPrefillContext && (
          <div className="relative z-30 rounded-2xl bg-gradient-to-b from-sky-50/85 to-sky-50/55 backdrop-blur-[10px] backdrop-saturate-150 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(125,180,210,0.32)] p-3 flex items-center gap-3">
            <span className="text-[12.5px] font-semibold text-sky-900 shrink-0">Compte Instagram</span>
            <Select
              value={selectedAccountId || libraryPrefillContext.selectedAccountId || ""}
              onChange={(id) => {
                if (!id) return;
                // Si le prefill était déjà chargé SSR, on recharge via client
                void handleAccountChange(id);
              }}
              placeholder="— Sélectionner un compte —"
              disabled={prefillLoading}
              options={instagramAccounts.map((a) => ({
                value: a.id,
                label: `@${a.handle}${a.name ? ` · ${a.name}` : ""}`,
              }))}
              variant="glass"
              className="flex-1"
            />
            {prefillLoading && (
              <span className="text-[11px] text-sky-600 shrink-0 flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-full border-2 border-sky-500 border-t-transparent animate-spin" />
                Chargement…
              </span>
            )}
          </div>
        )}

        {submitErrors.length > 0 && (
          <div className="rounded-2xl bg-gradient-to-b from-rose-50/85 to-rose-50/55 backdrop-blur-[10px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(201,113,133,0.32)] p-4 space-y-1">
            {submitErrors.map((e) => (
              <p key={e} className="text-[12.5px] text-rose-800">{e}</p>
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
                className="px-3 py-1.5 rounded-full bg-white/60 backdrop-blur-[8px] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_0_1px_rgba(15,23,42,0.06)] text-[11.5px] text-gray-600 hover:text-gray-950 hover:bg-white/80 transition-all"
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
              className={`rounded-2xl bg-gradient-to-b from-white/85 to-white/55 backdrop-blur-[10px] backdrop-saturate-150 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06),0_2px_8px_-4px_rgba(15,23,42,0.06)] p-5 md:p-6 scroll-mt-6 ${getFormSectionSpanClass(section)}`}
            >
            {!(hasOnlyUnsectionedSection && section.id === UNSECTIONED_FORM_SECTION_ID) ? (
              <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between mb-5">
                <div>
                  <p className="text-[10px] font-semibold tracking-widest uppercase text-gray-500">Section</p>
                  <h2 className="text-[20px] font-semibold text-gray-950 mt-1 tracking-tight">{section.title}</h2>
                  {section.description ? <p className="text-[12.5px] text-gray-500 mt-2 max-w-2xl">{section.description}</p> : null}
                </div>
                <div className="text-[11px] text-gray-400 tabular-nums">
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
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-gradient-to-t from-white/95 to-white/75 backdrop-blur-[12px] backdrop-saturate-150 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08),0_4px_16px_-4px_rgba(15,23,42,0.10),0_12px_32px_-8px_rgba(15,23,42,0.14)] px-4 py-3">
            <div className="text-[12.5px]">
              {remainingRequiredFields.length > 0 ? (
                <p className="font-medium text-peach-700">
                  {remainingRequiredFields.length} champ{remainingRequiredFields.length > 1 ? "s" : ""} obligatoire{remainingRequiredFields.length > 1 ? "s" : ""} restant{remainingRequiredFields.length > 1 ? "s" : ""}
                </p>
              ) : (
                <p className="font-medium text-sage-700 inline-flex items-center gap-1">
                  <span className="inline-flex h-1.5 w-1.5 rounded-full bg-sage-500 shadow-[0_0_6px_rgba(111,162,128,0.6)]" />
                  Tous les champs obligatoires sont remplis
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => router.back()}
                className="px-3.5 py-1.5 rounded-lg bg-white/60 backdrop-blur-[8px] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_0_1px_rgba(15,23,42,0.06)] text-[12.5px] text-gray-700 hover:bg-white/80 hover:text-gray-950 transition-all"
              >
                ← Retour
              </button>
              <button
                type="submit"
                disabled={generating || prefillLoading || (templateNeedsAccount && !libraryPrefillContext)}
                title={templateNeedsAccount && !libraryPrefillContext ? "Sélectionne un compte Instagram pour charger les suggestions" : undefined}
                className="px-5 py-1.5 rounded-lg bg-gradient-to-b from-gray-800 to-gray-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_2px_4px_rgba(15,23,42,0.18)] text-[12.5px] font-semibold text-white hover:from-gray-900 hover:to-gray-950 disabled:opacity-60 transition-all"
              >
                {generating ? "Génération…" : prefillLoading ? "Chargement…" : variants.length === 0 ? "Générer" : "Générer une variante"}
              </button>
            </div>
          </div>
        </div>
      </form>

      {/* ── Variants panel ───────────────────────────────────────────────── */}
      <div className={`w-full shrink-0 md:sticky md:top-6 space-y-3 order-1 md:order-none ${autoSubmit && variants.length > 0 ? "md:col-span-4" : "md:col-span-1"}`}>
        {!hasOnlyUnsectionedSection ? (
          <div className="rounded-2xl bg-gradient-to-b from-white/85 to-white/55 backdrop-blur-[10px] backdrop-saturate-150 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06),0_2px_8px_-4px_rgba(15,23,42,0.06)] p-4">
            <p className="text-[10px] font-semibold tracking-widest uppercase text-gray-500 mb-3">Navigation</p>
            <div className="space-y-1.5">
              {sections.map((section) => {
                const requiredCount = section.fields.filter((field) => field.required).length;
                const filledCount = section.fields.filter((field) => !field.required || isFilledValue(values[field.key])).length;
                const sectionErrorCount = section.fields.filter((field) => errors[field.key]).length;
                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => scrollToSection(section.id)}
                    className="w-full text-left px-3 py-2 rounded-xl bg-white/45 backdrop-blur-[6px] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_0_1px_rgba(15,23,42,0.04)] hover:bg-white/75 hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(125,180,210,0.32)] transition-all"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12.5px] font-medium text-gray-800">{section.title}</span>
                      {sectionErrorCount > 0 ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-50/70 text-rose-700 shadow-[inset_0_0_0_1px_rgba(201,113,133,0.22)]">{sectionErrorCount} err.</span>
                      ) : (
                        <span className="text-[10px] tabular-nums px-1.5 py-0.5 rounded-full bg-white/60 text-gray-500 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.06)]">{filledCount}/{section.fields.length}</span>
                      )}
                    </div>
                    <p className="text-[10.5px] text-gray-400 mt-0.5">{requiredCount > 0 ? `${requiredCount} champ${requiredCount > 1 ? "s" : ""} requis` : `${section.fields.length} champ${section.fields.length > 1 ? "s" : ""}`}</p>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {doneVariants.length > 0 && (
          <div className="rounded-xl bg-gradient-to-b from-peach-50/85 to-peach-50/55 backdrop-blur-[8px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(221,140,90,0.22)] px-3 py-2 flex items-center justify-between">
            <p className="text-[11.5px] font-semibold text-peach-800">{doneVariants.length} variante{doneVariants.length > 1 ? "s" : ""} générée{doneVariants.length > 1 ? "s" : ""}</p>
            <a
              href="/listings"
              className="text-[11.5px] text-peach-700 hover:text-peach-900 font-medium transition-colors"
            >
              Mes générations →
            </a>
          </div>
        )}

        {variants.length === 0 && (
          <div className="rounded-2xl bg-gradient-to-b from-white/65 to-white/40 backdrop-blur-[8px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)] p-6 flex flex-col items-center justify-center gap-2 text-gray-400">
            <span className="text-3xl">▦</span>
            <p className="text-[11.5px] text-center text-gray-500">Remplissez le formulaire<br />et cliquez sur Générer</p>
          </div>
        )}

        {/* F2-step3 — variant card extraite dans ListingFormVariantCard */}
        {variants.map((v) => (
          <ListingFormVariantCard key={v.id} variant={v} />
        ))}
      </div>
    </div>
  );
}

/** Champ select avec support des options dynamiques (optionsSource). */
