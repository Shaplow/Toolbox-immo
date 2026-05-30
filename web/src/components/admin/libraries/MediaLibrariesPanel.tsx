"use client";

/**
 * MediaLibrariesPanel — liste des bibliothèques médias (refonte MID Glass).
 *
 * Cards glass + Toolbar glass (search + Chips type/tags). Modal molecule pour
 * création. Édition inline préservée (rotation scope/mode + metadataSchema)
 * mais restylée en glass.
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Plus,
  Trash2,
  Video,
  Music2,
  Search,
  RotateCw,
  Upload,
  Settings2,
  Tag as TagIcon,
} from "lucide-react";
import { toast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/useConfirm";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { FormField } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
// LibraryExportButton retiré du flow card par défaut (export accessible via Drawer Settings).
import { MediaAssetsUploadModal } from "./mediaAssets/MediaAssetsUploadModal";
import { MediaLibrarySettingsDrawer } from "./MediaLibrarySettingsDrawer";
import { type PreviewAsset } from "./LibraryPreviewThumbs";
import { LazyVideoThumb } from "./mediaAssets/LazyVideoThumb";

interface MediaLibrary {
  id: string;
  name: string;
  type: "video" | "audio";
  tags: string;
  setSequence: string;
  rotationScope?: string;
  /** Mode rotation : "auto" | "override" | "none" | null (back-compat). */
  rotationMode?: string | null;
  metadataSchema?: string;
  /** Burn-once : null = rotation infinie, N ≥ 1 = consommation max par asset. */
  maxUsageCount?: number | null;
  description: string | null;
  createdAt: string;
  _count: { assets: number };
  /** Phase 4 — 4 assets les plus récents pour preview thumbs. */
  previewAssets?: PreviewAsset[];
}

export function MediaLibrariesPanel({ typeFilter: forcedType }: { typeFilter?: "video" | "audio" } = {}) {
  const router = useRouter();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const detailBasePath = forcedType === "audio" ? "/admin/libraries/audio" : "/admin/libraries/media";
  // Phase 2 médiathèque — drop-zone par card : quand l'user drag-drop des
  // fichiers sur une LibraryCard, on monte un MediaAssetsUploadModal pré-rempli
  // qui auto-upload via initialFiles. Après succès, navigate vers la lib.
  const [dropTarget, setDropTarget] = useState<{ lib: MediaLibrary; files: File[] } | null>(null);
  // Phase 4 — drawer réglages lib (remplace l'édition inline JSON par une UI structurée).
  const [settingsLib, setSettingsLib] = useState<MediaLibrary | null>(null);
  const [libraries, setLibraries] = useState<MediaLibrary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<{ name: string; type: "video" | "audio"; tags: string; description: string }>({
    name: "",
    type: forcedType ?? "video",
    tags: "",
    description: "",
  });
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSaving, setCreateSaving] = useState(false);
  const [search, setSearch] = useState("");
  // Toggle pour afficher/cacher la ligne des chips de tag-filter.
  const [tagsFilterOpen, setTagsFilterOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState<"" | "video" | "audio">("");
  const [typeLabelsFilter, setTypeLabelsFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const qs = forcedType ? `?type=${forcedType}` : "";
      const res = await fetch(`/api/admin/libraries/media${qs}`);
      if (!res.ok) throw new Error(`Erreur serveur (HTTP ${res.status})`);
      const data = (await res.json()) as MediaLibrary[];
      setLibraries(data);
    } catch (err) {
      console.error("[MediaLibrariesPanel] load error:", err);
      setLoadError(err instanceof Error ? err.message : "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }, [forcedType]);

  useEffect(() => {
    void load();
  }, [load]);

  const allTypes = useMemo(() => {
    const set = new Set<string>();
    libraries.forEach((lib) => {
      try {
        (JSON.parse(lib.tags) as string[]).forEach((t) => set.add(t));
      } catch {
        /* ignore */
      }
    });
    return Array.from(set).sort();
  }, [libraries]);

  const filtered = useMemo(() => {
    return libraries.filter((lib) => {
      if (typeFilter && lib.type !== typeFilter) return false;
      if (search.trim() && !lib.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (typeLabelsFilter) {
        try {
          const tags = JSON.parse(lib.tags) as string[];
          if (!tags.includes(typeLabelsFilter)) return false;
        } catch {
          return false;
        }
      }
      return true;
    });
  }, [libraries, typeFilter, search, typeLabelsFilter]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreateSaving(true);
    try {
      const tags = form.tags.split(",").map((t) => t.trim()).filter(Boolean);
      const res = await fetch("/api/admin/libraries/media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          type: form.type,
          tags,
          description: form.description,
        }),
      });
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        setCreateError(d.error ?? "Erreur");
        return;
      }
      const createdName = form.name;
      setCreating(false);
      setForm({ name: "", type: "video", tags: "", description: "" });
      toast.success(`Bibliothèque « ${createdName} » créée.`);
      void load();
    } catch {
      setCreateError("Erreur réseau");
    } finally {
      setCreateSaving(false);
    }
  }

  // Édition retirée — désormais via MediaLibrarySettingsDrawer (icône engrenage sur la card).

  async function handleDelete(id: string, name: string) {
    const ok = await confirm({
      title: `Supprimer la bibliothèque « ${name} » ?`,
      description: "Tous les assets associés seront également supprimés. Cette action est irréversible.",
      confirmLabel: "Supprimer",
      variant: "danger",
    });
    if (!ok) return;
    const res = await fetch(`/api/admin/libraries/media/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const d = (await res.json()) as { error?: string };
      toast.error(d.error ?? "Erreur lors de la suppression");
      return;
    }
    void load();
  }

  return (
    <div className="space-y-5">
      {/* Toolbar glass */}
      <div className="p-3 rounded-2xl bg-gradient-to-b from-white/75 to-white/55 backdrop-blur-[8px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08),0_2px_8px_-2px_rgba(15,23,42,0.06)]">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="w-[260px]">
            <Input
              value={search}
              onChange={setSearch}
              placeholder="Rechercher (nom)"
              icon={Search}
            />
          </div>
          {!forcedType && (
            <div className="flex items-center gap-1.5">
              <Chip
                variant={typeFilter === "" ? "sky" : "default"}
                selected={typeFilter === ""}
                onClick={() => setTypeFilter("")}
              >
                Tout
              </Chip>
              <Chip
                variant={typeFilter === "video" ? "sky" : "default"}
                selected={typeFilter === "video"}
                onClick={() => setTypeFilter("video")}
                icon={Video}
              >
                Vidéo
              </Chip>
              <Chip
                variant={typeFilter === "audio" ? "sage" : "default"}
                selected={typeFilter === "audio"}
                onClick={() => setTypeFilter("audio")}
                icon={Music2}
              >
                Audio
              </Chip>
            </div>
          )}
          {allTypes.length > 0 && (
            <Chip
              variant={tagsFilterOpen || typeLabelsFilter ? "sky" : "default"}
              selected={tagsFilterOpen || !!typeLabelsFilter}
              onClick={() => setTagsFilterOpen((o) => !o)}
              icon={TagIcon}
              size="sm"
            >
              Tags{typeLabelsFilter ? ` · ${typeLabelsFilter}` : ""}
            </Chip>
          )}
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[10.5px] text-gray-500 tabular-nums">
              {filtered.length}/{libraries.length}
            </span>
            <Button variant="primary" size="sm" icon={Plus} onClick={() => setCreating(true)}>
              Nouvelle bibliothèque
            </Button>
          </div>
        </div>

        {/* Tags filter (ligne dédiée si ouverte) — une seule ligne, scroll horizontal. */}
        {tagsFilterOpen && allTypes.length > 0 && (
          <div className="flex items-center gap-1 mt-2 overflow-x-auto whitespace-nowrap [scrollbar-width:thin]">
            {allTypes.map((t) => (
              <Chip
                key={t}
                variant={typeLabelsFilter === t ? "sky" : "default"}
                selected={typeLabelsFilter === t}
                onClick={() => setTypeLabelsFilter(typeLabelsFilter === t ? "" : t)}
                size="sm"
              >
                {t}
              </Chip>
            ))}
          </div>
        )}
      </div>

      {/* Error */}
      {loadError && (
        <div className="rounded-xl bg-rose-50/70 backdrop-blur-[8px] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_0_1px_rgba(201,113,133,0.22)]">
          <p className="text-[12.5px] font-semibold text-rose-900">
            Impossible de charger les bibliothèques
          </p>
          <p className="text-[11px] font-mono text-rose-800 mt-1">{loadError}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="text-[11px] text-rose-700 underline mt-2"
          >
            Réessayer
          </button>
        </div>
      )}

      {/* Loading */}
      {loading ? (
        <div className="rounded-2xl bg-gradient-to-b from-white/65 to-white/40 backdrop-blur-[8px] py-16 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)] flex items-center justify-center text-gray-500 gap-3">
          <div className="w-5 h-5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
          <span className="text-[12.5px]">Chargement…</span>
        </div>
      ) : libraries.length === 0 ? (
        <div className="rounded-2xl bg-gradient-to-b from-white/65 to-white/40 backdrop-blur-[8px] p-8 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)]">
          <EmptyState
            icon={Video}
            title="Aucune bibliothèque média"
            description="Créez-en une pour commencer à organiser vos vidéos et musiques."
            cta={{ label: "Nouvelle bibliothèque", onClick: () => setCreating(true) }}
          />
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-[12px] text-gray-500 italic text-center py-8">
          Aucune bibliothèque ne correspond aux filtres.
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {filtered.map((lib) => (
            <MediaLibraryCard
              key={lib.id}
              lib={lib}
              detailHref={`${detailBasePath}/${lib.id}`}
              onDelete={() => void handleDelete(lib.id, lib.name)}
              onFilesDropped={(files) => setDropTarget({ lib, files })}
              onOpenSettings={() => setSettingsLib(lib)}
            />
          ))}
        </div>
      )}

      {/* Modal création */}
      <Modal open={creating} onClose={() => !createSaving && setCreating(false)} size="lg">
        <Modal.Header onClose={() => !createSaving && setCreating(false)}>
          Nouvelle bibliothèque média
        </Modal.Header>
        <form
          onSubmit={(e) => {
            void handleCreate(e);
          }}
          className="contents"
        >
          <Modal.Body>
            <div className="space-y-4">
              <FormField label="Nom" required>
                <Input
                  required
                  value={form.name}
                  onChange={(v) => setForm((f) => ({ ...f, name: v }))}
                  placeholder="Ex: Rush RPI Paris"
                />
              </FormField>

              <FormField label="Type" required>
                <div className="flex gap-2">
                  {(["video", "audio"] as const).map((t) => (
                    <Chip
                      key={t}
                      variant={form.type === t ? (t === "video" ? "sky" : "sage") : "default"}
                      selected={form.type === t}
                      onClick={() => setForm((f) => ({ ...f, type: t }))}
                      icon={t === "video" ? Video : Music2}
                    >
                      {t === "video" ? "Vidéo" : "Audio"}
                    </Chip>
                  ))}
                </div>
              </FormField>

              <p className="text-[11px] text-gray-500 leading-relaxed">
                Tags, description, rotation et champs personnalisés sont éditables
                ensuite via le bouton <span className="font-semibold">Réglages</span> sur la card.
              </p>

              {createError && (
                <p className="text-[11px] text-rose-700">{createError}</p>
              )}
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setCreating(false)}
              disabled={createSaving}
            >
              Annuler
            </Button>
            <Button type="submit" variant="primary" icon={Plus} loading={createSaving}>
              Créer
            </Button>
          </Modal.Footer>
        </form>
      </Modal>

      {/* Phase 4 — drawer réglages lib (édition structurée, plus de JSON exposé). */}
      <MediaLibrarySettingsDrawer
        open={settingsLib !== null}
        onClose={() => setSettingsLib(null)}
        library={settingsLib}
        onUpdated={() => void load()}
      />

      {/* Phase 2 — modal upload auto déclenchée par drag-drop sur une LibraryCard.
          La modal récupère initialFiles et auto-démarre l'upload. Au succès,
          navigate vers la lib pour que l'user voit le résultat (et le ribbon
          orphelins l'invite à choisir une catégorie). */}
      {dropTarget && (
        <MediaAssetsUploadModal
          open={true}
          onClose={() => setDropTarget(null)}
          library={dropTarget.lib}
          accounts={[]}
          onUploaded={async () => {
            const targetId = dropTarget.lib.id;
            setDropTarget(null);
            router.push(`${detailBasePath}/${targetId}`);
          }}
          initialFiles={dropTarget.files}
          onInitialFilesConsumed={() => {}}
        />
      )}

      {confirmDialog}
    </div>
  );
}

// ─── MediaLibraryCard ──────────────────────────────────────────────────────

function MediaLibraryCard({
  lib,
  detailHref,
  onDelete,
  onFilesDropped,
  onOpenSettings,
}: {
  lib: MediaLibrary;
  /** Phase β — href dynamique selon type (/admin/libraries/media/[id] ou /admin/libraries/audio/[id]). */
  detailHref: string;
  onDelete: () => void;
  /** Phase 2 — callback drag-drop fichiers sur la card. */
  onFilesDropped?: (files: File[]) => void;
  /** Phase 4 — ouvre le drawer réglages structuré. */
  onOpenSettings?: () => void;
}) {
  const [dragOver, setDragOver] = useState(false);

  const tags = (() => {
    try {
      return JSON.parse(lib.tags) as string[];
    } catch {
      return [];
    }
  })();
  const seq = (() => {
    try {
      return JSON.parse(lib.setSequence) as string[];
    } catch {
      return [];
    }
  })();
  const isVideo = lib.type === "video";

  function isFileDrag(e: React.DragEvent): boolean {
    return Array.from(e.dataTransfer.types).includes("Files");
  }
  function handleDragEnter(e: React.DragEvent) {
    if (!onFilesDropped || !isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }
  function handleDragOver(e: React.DragEvent) {
    if (!onFilesDropped || !isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
  }
  function handleDragLeave(e: React.DragEvent) {
    if (!onFilesDropped) return;
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOver(false);
    }
  }
  function handleDrop(e: React.DragEvent) {
    if (!onFilesDropped) return;
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter((f) =>
      isVideo ? f.type.startsWith("video/") : f.type.startsWith("audio/"),
    );
    if (files.length === 0) {
      toast.error(isVideo ? "Aucun fichier vidéo détecté" : "Aucun fichier audio détecté");
      return;
    }
    onFilesDropped(files);
  }

  // Cover : 1er asset video (preview thumbnail). Fallback gradient pastel si lib vide ou audio.
  const cover = lib.previewAssets?.find((a) => a.mimeType.startsWith("video/"));

  return (
    <Link
      href={detailHref}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={[
        "group relative block aspect-[9/16] rounded-2xl overflow-hidden transition-all",
        "shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_0_1px_rgba(15,23,42,0.06),0_2px_8px_-2px_rgba(15,23,42,0.08)]",
        dragOver
          ? "ring-2 ring-sage-400 scale-[1.015]"
          : "hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.1),0_8px_24px_-6px_rgba(15,23,42,0.18),0_24px_48px_-12px_rgba(15,23,42,0.22)] hover:-translate-y-0.5",
      ].join(" ")}
    >
      {/* Cover plein (video thumb si dispo, sinon fallback gradient pastel teinté type). */}
      {cover ? (
        <LazyVideoThumb url={cover.url} className="absolute inset-0 w-full h-full object-cover" />
      ) : (
        <div
          className={[
            "absolute inset-0",
            isVideo
              ? "bg-gradient-to-br from-sky-100 via-sky-50 to-white"
              : "bg-gradient-to-br from-sage-100 via-sage-50 to-white",
          ].join(" ")}
        >
          <div className="absolute inset-0 flex items-center justify-center opacity-30">
            {isVideo ? <Video size={64} className="text-sky-600" /> : <Music2 size={64} className="text-sage-600" />}
          </div>
        </div>
      )}

      {/* Voile gradient bottom — assure lisibilité du titre + meta sur n'importe quel cover. */}
      <div className="absolute inset-x-0 bottom-0 h-[60%] bg-gradient-to-t from-gray-950/90 via-gray-950/60 to-transparent pointer-events-none" />

      {/* Badge type + count en haut-left, glass subtle. */}
      <div className="absolute top-3 left-3 inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/85 backdrop-blur-[10px] backdrop-saturate-150 text-[10.5px] font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)]">
        {isVideo ? <Video size={11} className="text-sky-600" /> : <Music2 size={11} className="text-sage-600" />}
        <span className="tabular-nums">{lib._count.assets}</span>
      </div>

      {/* Actions au hover top-right — glass icons. */}
      <div className="absolute top-3 right-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity z-10">
        {onOpenSettings && (
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onOpenSettings(); }}
            title="Réglages"
            className="h-7 w-7 inline-flex items-center justify-center rounded-md bg-white/85 backdrop-blur-[10px] text-gray-700 hover:text-gray-950 hover:bg-white shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08),0_2px_4px_rgba(15,23,42,0.08)]"
          >
            <Settings2 size={12} />
          </button>
        )}
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(); }}
          title="Supprimer"
          className="h-7 w-7 inline-flex items-center justify-center rounded-md bg-white/85 backdrop-blur-[10px] text-gray-500 hover:text-rose-600 hover:bg-white shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08),0_2px_4px_rgba(15,23,42,0.08)]"
        >
          <Trash2 size={12} />
        </button>
      </div>

      {/* Titre + meta en bas — par-dessus le voile. */}
      <div className="absolute inset-x-0 bottom-0 p-3 z-[5] flex flex-col gap-1.5">
        <h3 className="text-[15px] sm:text-[17px] font-semibold tracking-tight text-white leading-[1.15] drop-shadow-[0_1px_2px_rgba(0,0,0,0.3)] line-clamp-2">
          {lib.name}
        </h3>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tags.slice(0, 2).map((tag) => (
              <span key={tag} className="inline-flex items-center px-1.5 py-0.5 rounded text-[9.5px] font-medium bg-white/25 backdrop-blur-[6px] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)]">
                {tag}
              </span>
            ))}
            {tags.length > 2 && (
              <span className="text-[9.5px] text-white/60 self-center">+{tags.length - 2}</span>
            )}
          </div>
        )}
        <div className="flex items-center gap-1.5 text-[9.5px] text-white/80">
          <span className="inline-flex items-center gap-0.5">
            <RotateCw size={9} />
            {seq.length > 0 ? "Ordre fixe" : "Rotation auto"}
          </span>
          <span className="text-white/40">·</span>
          <span>{lib.rotationScope === "shared" ? "Partagé" : "Par compte"}</span>
        </div>
      </div>

      {/* Drag-drop overlay (par-dessus tout). */}
      {dragOver && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-sage-50/85 backdrop-blur-[2px] rounded-2xl pointer-events-none">
          <div className="flex flex-col items-center gap-2 text-sage-700">
            <Upload size={28} />
            <span className="text-[12.5px] font-semibold text-center px-3">Déposer dans « {lib.name} »</span>
          </div>
        </div>
      )}

      <span className="sr-only">Voir les fichiers · {lib._count.assets} fichier{lib._count.assets !== 1 ? "s" : ""}</span>
    </Link>
  );
}
