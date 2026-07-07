"use client";

/**
 * MediaAssetsUploadModal — modal d'upload de MediaAsset avec drag-drop,
 * config (catégorie / pack / tags / compte IG) et progress bar.
 *
 * Phase D7 du split C1-v2 (plan §19). Le composant encapsule tous les
 * states + handlers async (presign + XHR upload + bulk apply meta) qui
 * étaient inline dans MediaAssetsPanel.
 *
 * Le parent contrôle l'ouverture via la prop `open` et la fermeture via
 * `onClose`. La modal ne se ferme pas elle-même pour permettre des
 * scénarios comme "open via drag-drop sur la page" qui restent gérés
 * par le parent.
 *
 * Le parent passe `library` (id + type) et `accounts` pour adapter la
 * UI (filtre type vidéo/audio, dropdown comptes). Quand l'upload réussit,
 * `onUploaded()` est appelé pour permettre au parent de refetch la liste.
 *
 * Phase 1 médiathèque (2026-05-30) : wording "Set" → "Pack" (plus parlant
 * pour un noob), auto-suggest depuis filename (regex patterns courants),
 * tooltips explicatifs Catégorie/Pack via Info icon.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Upload, X, FolderOpen, Layers, Tag, CheckCircle2, Info, Sparkles, Globe, ChevronRight } from "lucide-react";
import { Tooltip } from "@/components/ui/Tooltip";
import { Combobox } from "@/components/ui/Combobox";
import { Chip } from "@/components/ui/Chip";
import { Modal } from "@/components/ui/Modal";
import { captureVideoPoster } from "./captureVideoPoster";
import type { InstagramAccount, MediaLibrary } from "./types";
import { normalizeCustomFields } from "@/lib/customFields";
import { CustomFieldValueInput } from "@/components/fields/CustomFieldValueInput";

/**
 * Analyse les filenames pour suggérer Catégorie + Pack.
 * Heuristique conservatrice : ne suggère que si TOUS les fichiers s'accordent
 * sur le même match. Sinon laisse vide (mieux que de proposer une valeur fausse).
 */
function suggestFromFilenames(files: File[]): { category?: string; setTag?: string } {
  if (files.length === 0) return {};

  const matches = files.map((f) => {
    const base = f.name.toLowerCase().replace(/\.[^.]+$/, "");
    return { category: matchCategory(base), setTag: matchPack(base) };
  });

  const cats = new Set(matches.map((m) => m.category).filter(Boolean));
  const packs = new Set(matches.map((m) => m.setTag).filter(Boolean));

  return {
    category: cats.size === 1 ? Array.from(cats)[0] : undefined,
    setTag: packs.size === 1 ? Array.from(packs)[0] : undefined,
  };
}

function matchCategory(name: string): string | undefined {
  const tenue = name.match(/tenue[\s_-]?(\d+)/);
  if (tenue) return `Tenue ${tenue[1]}`;
  const cat = name.match(/\bcat[_-]([a-z0-9]+)/);
  if (cat) return cat[1].charAt(0).toUpperCase() + cat[1].slice(1);
  if (/(?:^|[\s_-])(?:int|interieur|intérieur)(?:[\s_-]|$)/.test(name)) return "Intérieur";
  if (/(?:^|[\s_-])(?:ext|exterieur|extérieur)(?:[\s_-]|$)/.test(name)) return "Extérieur";
  return undefined;
}

function matchPack(name: string): string | undefined {
  const pack = name.match(/\bpack[_-]([a-z0-9-]+)/);
  if (pack) return pack[1];
  const set = name.match(/\bset[_-]([a-z0-9-]+)/);
  if (set) return set[1];
  const session = name.match(/\bsession[_-]?([a-z0-9-]+)/);
  if (session) return `session-${session[1]}`;
  return undefined;
}

interface Props {
  open: boolean;
  onClose: () => void;
  library: MediaLibrary;
  accounts: InstagramAccount[];
  /** Appelé après upload réussi pour que le parent refetch la liste. */
  onUploaded: () => void | Promise<void>;
  /**
   * Fichiers pré-fournis (typiquement via drop-zone page-level).
   * Quand non-vide, ils sont ajoutés à la QUEUE à l'ouverture de la modal (pas
   * d'upload auto) : l'admin configure puis clique « Lancer l'upload ».
   * Le parent doit le reset à null après consommation pour éviter un ré-ajout.
   */
  initialFiles?: File[] | null;
  onInitialFilesConsumed?: () => void;
}

export function MediaAssetsUploadModal({
  open,
  onClose,
  library,
  accounts,
  onUploaded,
  initialFiles,
  onInitialFilesConsumed,
}: Props) {
  const isVideo = library.type === "video";
  // Mode manuel (rotation "none") : on cache Catégorie + Pack et on affiche
  // à la place les champs metadata pour identifier l'asset (ex: nom du bien, prix…).
  const isManualMode = library.rotationMode === "none";
  // Parse metadataSchema via le parser canonique (supporte legacy string[]).
  const metadataFields = useMemo(
    () => normalizeCustomFields(library.metadataSchema),
    [library.metadataSchema],
  );

  // ─ State local à la modal (extrait de MediaAssetsPanel)
  const [uploadCategory, setUploadCategory] = useState("");
  const [uploadSetTag, setUploadSetTag] = useState("");
  // Le « Groupe » (setTag) ne sert qu'à rassembler des plans joués ensemble —
  // besoin de niche. On le replie sous « Options avancées » par défaut, déplié
  // auto si une valeur est déjà saisie/suggérée.
  const [showAdvancedUpload, setShowAdvancedUpload] = useState(false);
  // Phase γ — multi-select comptes. Vide = global. Sinon restreint aux comptes listés.
  const [uploadAccountIds, setUploadAccountIds] = useState<string[]>([]);
  // Phase γ.bis — tags multi-select avec Combobox autocomplete.
  const [uploadTags, setUploadTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  // Mode manuel — valeurs metadata saisies (key → value).
  const [uploadMetadata, setUploadMetadata] = useState<Record<string, string>>({});
  // Phase γ — Combobox autocomplete : on fetch les categories/packs/tags existants au mount.
  const [existingCategories, setExistingCategories] = useState<string[]>([]);
  const [existingPacks, setExistingPacks] = useState<string[]>([]);
  const [existingTags, setExistingTags] = useState<string[]>([]);
  const [modalUploading, setModalUploading] = useState(false);
  const [modalProgress, setModalProgress] = useState<number | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [modalSuccess, setModalSuccess] = useState<string | null>(null);
  const [modalDragOver, setModalDragOver] = useState(false);
  // Phase 1 : mémorise les derniers fichiers droppés/sélectionnés pour calculer
  // les suggestions Catégorie/Pack. Reste valide jusqu'à la prochaine fournée
  // ou la fermeture de la modal — l'upload bulk meta s'applique APRÈS l'upload
  // R2, donc l'user a le temps de cliquer un chip suggestion même upload en cours.
  const [recentFilenames, setRecentFilenames] = useState<string[]>([]);
  // W4 : queue de fichiers en attente d'upload — populée par le drop page-level.
  // L'upload ne démarre qu'au clic "Lancer l'upload" pour que l'admin ait le
  // temps de configurer catégorie/pack/comptes/tags avant le lancement.
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const suggestion = useMemo(
    () => suggestFromFilenames(recentFilenames.map((n) => ({ name: n } as File))),
    [recentFilenames],
  );

  // ESC pour fermer (sauf pendant un upload en cours).
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !modalUploading) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, modalUploading, onClose]);

  // Phase γ — au mount du modal, fetch les categories/packs déjà utilisés dans la lib
  // pour pré-remplir l'autocomplete des Combobox. Léger : on lit juste les noms distincts.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/admin/libraries/media/${library.id}/assets`);
        if (!res.ok) return;
        // API retourne tags comme JSON string (pas array). On parse defensively.
        const assets = (await res.json()) as Array<{ category: string | null; setTag: string | null; tags: unknown }>;
        if (cancelled) return;
        const cats = new Set<string>();
        const packs = new Set<string>();
        const tags = new Set<string>();
        for (const a of assets) {
          if (a.category) cats.add(a.category);
          if (a.setTag && !a.setTag.startsWith("pack_")) packs.add(a.setTag);
          // tags peut être string JSON OU array déjà parsé selon endpoint.
          let parsed: string[] = [];
          if (Array.isArray(a.tags)) parsed = a.tags as string[];
          else if (typeof a.tags === "string") {
            try { parsed = JSON.parse(a.tags) as string[]; } catch { parsed = []; }
          }
          parsed.forEach((t) => { if (typeof t === "string" && t.trim()) tags.add(t); });
        }
        setExistingCategories(Array.from(cats).sort());
        setExistingPacks(Array.from(packs).sort());
        setExistingTags(Array.from(tags).sort());
      } catch {
        /* fallback : Combobox marche avec allowCustom même sans options */
      }
    })();
    return () => { cancelled = true; };
  }, [open, library.id]);

  // W4 : drop page-level → on PRÉ-REMPLIT la queue (recentFilenames + dropped
  // state) sans lancer l'upload. L'admin voit les fichiers + sa config
  // (catégorie/pack/comptes) et clique "Lancer l'upload" pour démarrer.
  // Avant : l'upload partait immédiatement → assets orphelins sans tag/pack
  // si l'user fermait la modal avant de configurer.
  useEffect(() => {
    if (!open || !initialFiles || initialFiles.length === 0) return;
    const filtered = initialFiles.filter((f) =>
      isVideo ? f.type.startsWith("video/") : f.type.startsWith("audio/"),
    );
    if (filtered.length > 0) {
      // append (pas replace) → accumulation cohérente si la modale est déjà
      // ouverte avec des fichiers en queue.
      setPendingFiles((prev) => [...prev, ...filtered]);
      setRecentFilenames((prev) => [...prev, ...filtered.map((f) => f.name)]);
    }
    onInitialFilesConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialFiles]);

  async function uploadFiles(files: File[]) {
    if (files.length === 0) return;
    setRecentFilenames(files.map((f) => f.name));
    setModalUploading(true);
    setModalError(null);
    setModalSuccess(null);
    setModalProgress(0);

    const uploadedIds: string[] = [];
    const failed: string[] = [];

    // Concurrency-limited parallel uploader (3 simultanés) :
    // - le presign reste sequential (pas la bottleneck), c'est l'upload qui
    //   bénéficie du parallélisme.
    // - on agrège le progress via une map fileIdx → percent.
    const CONCURRENCY = 3;
    const progressMap = new Map<number, number>();

    function refreshOverallProgress() {
      let sum = 0;
      for (const v of progressMap.values()) sum += v;
      const overall = Math.round((sum / files.length) * 100);
      setModalProgress(overall);
    }

    // Capture une frame côté navigateur et l'upload comme poster (vignette).
    // Best-effort : toute erreur est avalée par l'appelant (fallback <video>).
    async function uploadPosterFor(assetId: string, file: File): Promise<void> {
      const blob = await captureVideoPoster(file);
      if (!blob) return;
      const res = await fetch(
        `/api/admin/libraries/media/${library.id}/assets/${assetId}/poster`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ size: blob.size }),
        },
      );
      if (!res.ok) return;
      const { uploadUrl } = (await res.json()) as { uploadUrl: string };
      await new Promise<void>((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", uploadUrl);
        xhr.setRequestHeader("Content-Type", "image/jpeg");
        xhr.addEventListener("load", () => resolve());
        xhr.addEventListener("error", () => resolve());
        xhr.send(blob);
      });
    }

    async function uploadOne(idx: number): Promise<void> {
      const file = files[idx]!;
      progressMap.set(idx, 0);
      const presignRes = await fetch(`/api/admin/libraries/media/${library.id}/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, contentType: file.type, size: file.size }),
      });
      if (!presignRes.ok) {
        failed.push(file.name);
        progressMap.set(idx, 100);
        refreshOverallProgress();
        return;
      }
      const { uploadUrl, assetId } = (await presignRes.json()) as { uploadUrl: string; assetId: string };

      const ok = await new Promise<boolean>((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", uploadUrl);
        xhr.setRequestHeader("Content-Type", file.type);
        xhr.upload.addEventListener("progress", (ev) => {
          if (ev.lengthComputable) {
            progressMap.set(idx, ev.loaded / ev.total);
            refreshOverallProgress();
          }
        });
        xhr.addEventListener("load", () => resolve(xhr.status >= 200 && xhr.status < 300));
        xhr.addEventListener("error", () => resolve(false));
        xhr.send(file);
      });
      progressMap.set(idx, 1);
      refreshOverallProgress();
      if (ok) {
        // L'endpoint /confirm fait un HEAD R2 pour valider que l'objet existe vraiment
        // (XHR peut "réussir" en cas d'aller-retour réseau pathologique sans data écrite,
        // ou si R2 répond 2xx tout en perdant le body). Si l'objet manque, la route
        // supprime le MediaAsset pending et empêche l'asset fantôme d'entrer en rotation.
        try {
          const confirmRes = await fetch(
            `/api/admin/libraries/media/assets/${assetId}/confirm`,
            { method: "PATCH" },
          );
          if (!confirmRes.ok) {
            failed.push(file.name);
            return;
          }
        } catch {
          failed.push(file.name);
          return;
        }
        uploadedIds.push(assetId);
        // Poster vignette (best-effort, non bloquant) — vidéos uniquement.
        if (isVideo) {
          await uploadPosterFor(assetId, file).catch(() => {
            /* poster échoué → fallback <video> côté grille */
          });
        }
      } else {
        failed.push(file.name);
      }
    }

    // Worker pool : `CONCURRENCY` workers tirent depuis une queue partagée.
    let next = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCY, files.length) }, async () => {
      while (next < files.length) {
        const idx = next++;
        await uploadOne(idx);
      }
    });
    await Promise.all(workers);

    if (failed.length > 0) {
      setModalError(`Échec(s) : ${failed.slice(0, 3).join(", ")}${failed.length > 3 ? "…" : ""}`);
      if (uploadedIds.length === 0) {
        setModalUploading(false);
        return;
      }
    }

    // Apply category / pack / tags / access / metadata to all newly uploaded assets.
    const bulkData: Record<string, unknown> = { assetIds: uploadedIds };
    if (isManualMode) {
      // Mode manuel : pas de pack auto (asset jamais utilisé en rotation auto).
      // On envoie juste les metadata saisies — c'est l'identifiant pour la sélection
      // côté générateur via champ formulaire.
      const filledMeta = Object.fromEntries(
        Object.entries(uploadMetadata).filter(([, v]) => v.trim() !== ""),
      );
      if (Object.keys(filledMeta).length > 0) bulkData.metadata = filledMeta;
    } else {
      // Pas de pack auto : on n'assigne un Groupe (setTag) QUE si l'user en a
      // saisi un. Sinon on laisse `null` — l'asset entre quand même en rotation
      // (le resolver inclut le groupe orphelin null/null).
      const setTagValue = uploadSetTag.trim();
      if (setTagValue) bulkData.setTag = setTagValue;
      if (uploadCategory.trim()) bulkData.category = uploadCategory.trim();
    }
    const tagsList = uploadTags.map((t) => t.trim()).filter(Boolean);
    if (tagsList.length > 0) bulkData.tags = tagsList;
    if (uploadAccountIds.length > 0) {
      bulkData.accessAction = "add";
      bulkData.accountIds = uploadAccountIds;
    }
    if (uploadedIds.length > 0) {
      await fetch(`/api/admin/libraries/media/${library.id}/assets/bulk`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bulkData),
      });
    }

    const okCount = uploadedIds.length;
    setModalSuccess(
      `${okCount} fichier${okCount > 1 ? "s" : ""} uploadé${okCount > 1 ? "s" : ""}` +
        (failed.length > 0 ? ` · ${failed.length} échec(s)` : ""),
    );
    setModalProgress(null);
    setModalUploading(false);
    await onUploaded();
  }

  // Met des fichiers en QUEUE (pas d'upload immédiat) : filtre par type puis
  // append à pendingFiles + recentFilenames (ce dernier alimente les suggestions
  // catégorie/Groupe). L'upload ne part qu'au clic « Lancer l'upload ». Toutes
  // les entrées (parcourir, drop modale, drop page-level) passent par ici pour
  // une UX cohérente « sélection → config → upload ».
  function addToQueue(rawFiles: File[]) {
    const filtered = rawFiles.filter((f) =>
      isVideo ? f.type.startsWith("video/") : f.type.startsWith("audio/"),
    );
    if (filtered.length === 0) return;
    setPendingFiles((prev) => [...prev, ...filtered]);
    setRecentFilenames((prev) => [...prev, ...filtered.map((f) => f.name)]);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    addToQueue(files);
  }

  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      dismissOnBackdrop={!modalUploading}
    >
      <div
        className="flex flex-col"
        onDragOver={(e) => {
          e.preventDefault();
          setModalDragOver(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setModalDragOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setModalDragOver(false);
          addToQueue(Array.from(e.dataTransfer.files));
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <h2 className="text-base font-semibold text-gray-900">Uploader des fichiers</h2>
          <button
            onClick={() => {
              if (!modalUploading) onClose();
            }}
            disabled={modalUploading}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-muted text-muted-foreground disabled:opacity-40"
          >
            <X size={16} />
          </button>
        </div>
        {/* Body */}
        <div className="p-6 flex flex-col gap-4 overflow-y-auto">
          {/* Drop zone */}
          <div
            className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center gap-3 transition-colors ${
              modalDragOver ? "border-info-200 bg-info-50" : "border-border bg-muted"
            }`}
          >
            <Upload size={28} className={modalDragOver ? "text-info-200" : "text-muted-foreground/60"} />
            <p className="text-sm text-muted-foreground text-center">Glissez vos fichiers ici</p>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={modalUploading}
              className="px-3 py-1.5 border border-border rounded-lg text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              Parcourir…
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={isVideo ? "video/*" : "audio/*"}
              onChange={handleFileChange}
              className="hidden"
            />
            {/* W4 : queue page-level drop — l'admin configure puis lance. */}
            {pendingFiles.length > 0 && !modalUploading && (
              <div className="mt-2 w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-white border border-info-200">
                <span className="text-xs text-foreground">
                  {pendingFiles.length} fichier{pendingFiles.length > 1 ? "s" : ""} prêt{pendingFiles.length > 1 ? "s" : ""} à uploader
                </span>
                <button
                  onClick={() => {
                    const files = pendingFiles;
                    setPendingFiles([]);
                    void uploadFiles(files);
                  }}
                  className="px-3 py-1 bg-gray-900 hover:bg-gray-800 text-white text-xs font-medium rounded-md"
                >
                  Lancer l&apos;upload
                </button>
              </div>
            )}
          </div>
          {/* Config fields */}
          <div className="flex flex-col gap-3.5">
            {/* Phase γ — Destination (comptes IG) en haut, visuel et multi-select. */}
            {accounts.length > 0 && (
              <div className="rounded-xl bg-gradient-to-b from-info-50/55 to-white/45 p-3  space-y-2">
                <p className="text-[11px] uppercase tracking-widest font-semibold text-info-700">
                  Destination
                </p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Par défaut visible par tous les comptes. Clique sur un ou plusieurs comptes pour restreindre.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <Chip
                    variant={uploadAccountIds.length === 0 ? "sky" : "default"}
                    selected={uploadAccountIds.length === 0}
                    onClick={() => setUploadAccountIds([])}
                    size="sm"
                    icon={Globe}
                  >
                    Global
                  </Chip>
                  {accounts.map((a) => {
                    const active = uploadAccountIds.includes(a.id);
                    return (
                      <Chip
                        key={a.id}
                        variant={active ? "sky" : "default"}
                        selected={active}
                        onClick={() =>
                          setUploadAccountIds((prev) =>
                            prev.includes(a.id) ? prev.filter((x) => x !== a.id) : [...prev, a.id],
                          )
                        }
                        size="sm"
                      >
                        @{a.handle}
                      </Chip>
                    );
                  })}
                </div>
              </div>
            )}

            {/* En mode manuel (rotation = "none") : on cache Catégorie/Pack et on affiche
                les champs metadata pour identifier l'asset (ex: nom du bien, prix…).
                Sinon : Catégorie + Pack en grid 2-cols. */}
            {isManualMode ? (
              metadataFields.length > 0 ? (
                <div className="rounded-xl bg-card border border-border p-3  space-y-2.5">
                  <p className="text-[11px] uppercase tracking-widest font-semibold text-muted-foreground">
                    Champs personnalisés
                  </p>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Ces valeurs identifient les fichiers pour la sélection côté générateur (rotation auto désactivée sur cette bibliothèque).
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {metadataFields.map((f) => (
                      <div key={f.key}>
                        <CustomFieldValueInput
                          field={f}
                          value={uploadMetadata[f.key] ?? ""}
                          onChange={(v) => setUploadMetadata((prev) => ({ ...prev, [f.key]: v }))}
                          showLabel
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground italic px-2">
                  Aucun champ personnalisé défini sur cette bibliothèque. Ajoute-en via le drawer Réglages pour remplir les metadata à l&apos;upload.
                </p>
              )
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="flex items-center gap-1 text-xs font-medium text-muted-foreground mb-1">
                    <FolderOpen size={10} /> Catégorie
                    <Tooltip content="Le thème — sert à éviter de répéter le même type d'asset deux fois de suite dans la rotation. Ex : « Tenue 1 », « Intérieur », « Plan large »." side="top">
                      <Info size={10} className="text-muted-foreground/60 hover:text-muted-foreground cursor-help" />
                    </Tooltip>
                  </label>
                  {suggestion.category && !uploadCategory && (
                    <button
                      type="button"
                      onClick={() => setUploadCategory(suggestion.category!)}
                      className="mb-1 inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-md bg-success-50/80 text-success-700 hover:bg-success-100 transition-colors"
                    >
                      <Sparkles size={9} /> Suggéré : {suggestion.category}
                    </button>
                  )}
                  <Combobox
                    value={uploadCategory}
                    onChange={setUploadCategory}
                    options={existingCategories.map((c) => ({ value: c, label: c, icon: FolderOpen }))}
                    allowCustom
                    placeholder="Choisir ou créer…"
                    emptyMessage="Aucune catégorie pour l'instant. Tapez un nom pour en créer une."
                  />
                </div>

                {/* Groupe (setTag) — replié sous « Options avancées » (besoin de
                    niche : rassembler des plans joués ensemble). Déplié auto si
                    une valeur est déjà saisie ou suggérée. */}
                {showAdvancedUpload || uploadSetTag || suggestion.setTag ? (
                  <div>
                    <label className="flex items-center gap-1 text-xs font-medium text-muted-foreground mb-1">
                      <Layers size={10} /> Groupe
                      <Tooltip content="Plans qui doivent être joués ensemble dans le même rendu (ex : intro + outro filmés ensemble). Laisse vide si chaque fichier est indépendant." side="top">
                        <Info size={10} className="text-muted-foreground/60 hover:text-muted-foreground cursor-help" />
                      </Tooltip>
                    </label>
                    {suggestion.setTag && !uploadSetTag && (
                      <button
                        type="button"
                        onClick={() => setUploadSetTag(suggestion.setTag!)}
                        className="mb-1 inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-md bg-success-50/80 text-success-700 hover:bg-success-100 transition-colors"
                      >
                        <Sparkles size={9} /> Suggéré : {suggestion.setTag}
                      </button>
                    )}
                    <Combobox
                      value={uploadSetTag}
                      onChange={setUploadSetTag}
                      options={existingPacks.map((p) => ({ value: p, label: p, icon: Layers }))}
                      allowCustom
                      placeholder="Choisir, créer ou laisser vide…"
                      emptyMessage="Aucun groupe. Tapez un nom ou laissez vide."
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowAdvancedUpload(true)}
                    className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ChevronRight size={12} /> Options avancées (Groupe)
                  </button>
                )}
              </div>
            )}

            <div>
              <label className="flex items-center gap-1 text-xs font-medium text-muted-foreground mb-1">
                <Tag size={10} /> Tags (optionnel)
                <Tooltip content="Étiquettes libres pour filtrer / rechercher tes assets. Click sur un tag existant pour le réutiliser et éviter les doublons (Intro vs intro, etc.)." side="top">
                  <Info size={10} className="text-muted-foreground/60 hover:text-muted-foreground cursor-help" />
                </Tooltip>
              </label>
              {uploadTags.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-1.5">
                  {uploadTags.map((t) => (
                    <Chip
                      key={t}
                      variant="sky"
                      size="sm"
                      onRemove={() => setUploadTags((prev) => prev.filter((x) => x !== t))}
                    >
                      {t}
                    </Chip>
                  ))}
                </div>
              )}
              <Combobox
                value={tagDraft}
                onChange={(v) => {
                  const clean = v.trim();
                  if (!clean) return;
                  if (!uploadTags.includes(clean)) {
                    setUploadTags((prev) => [...prev, clean]);
                  }
                  setTagDraft("");
                }}
                options={existingTags
                  .filter((t) => !uploadTags.includes(t))
                  .map((t) => ({ value: t, label: t, icon: Tag }))}
                allowCustom
                placeholder="Choisir ou créer un tag…"
                emptyMessage="Aucun tag pour l'instant. Tapez un nom pour en créer un."
              />
            </div>
          </div>
          {/* Progress */}
          {modalUploading && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-info-700">
                <span>Upload en cours…</span>
                <span>{modalProgress ?? 0}%</span>
              </div>
              <div className="h-1.5 bg-info-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-info-600 transition-all duration-200"
                  style={{ width: `${modalProgress ?? 0}%` }}
                />
              </div>
            </div>
          )}
          {modalError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{modalError}</div>
          )}
          {modalSuccess && (
            <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700 flex items-center gap-2">
              <CheckCircle2 size={14} /> {modalSuccess} — glissez d&apos;autres fichiers ou fermez.
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
