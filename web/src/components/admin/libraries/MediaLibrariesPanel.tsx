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
import { rotationScopeLabel } from "@/lib/i18n/entityLabels";

interface MediaLibrary {
  id: string;
  name: string;
  type: "video" | "audio";
  tags: string;
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

export function MediaLibrariesPanel({
  typeFilter: forcedType,
  // Gestion asset-level (upload par drag-drop sur une card). ADMIN + VIDEASTE.
  canManageAssets = false,
  // Gestion library-level (créer / réglages / supprimer). Réservé ADMIN ;
  // un VIDEASTE gère les assets mais pas les librairies. Défaut false = least-privilege.
  canManageLibraries = false,
}: {
  typeFilter?: "video" | "audio";
  canManageAssets?: boolean;
  canManageLibraries?: boolean;
} = {}) {
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
      <div className="p-3 rounded-2xl bg-card border border-border ">
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
            <span className="text-[10.5px] text-muted-foreground tabular-nums">
              {filtered.length}/{libraries.length}
            </span>
            {canManageLibraries && (
              <Button variant="primary" size="sm" icon={Plus} onClick={() => setCreating(true)}>
                Nouvelle bibliothèque
              </Button>
            )}
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
        <div className="rounded-xl bg-danger-50/70 p-3 ">
          <p className="text-[12.5px] font-semibold text-danger-700">
            Impossible de charger les bibliothèques
          </p>
          <p className="text-[11px] font-mono text-danger-700 mt-1">{loadError}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="text-[11px] text-danger-700 underline mt-2"
          >
            Réessayer
          </button>
        </div>
      )}

      {/* Loading */}
      {loading ? (
        <div className="rounded-2xl bg-card border border-border py-16  flex items-center justify-center text-muted-foreground gap-3">
          <div className="w-5 h-5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
          <span className="text-[12.5px]">Chargement…</span>
        </div>
      ) : libraries.length === 0 ? (
        <div className="rounded-2xl bg-card border border-border p-8 ">
          <EmptyState
            icon={Video}
            title="Aucune bibliothèque média"
            description={
              canManageLibraries
                ? "Créez-en une pour commencer à organiser vos vidéos et musiques."
                : "Aucune bibliothèque n'est encore disponible."
            }
            cta={
              canManageLibraries
                ? { label: "Nouvelle bibliothèque", onClick: () => setCreating(true) }
                : undefined
            }
          />
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-[12px] text-muted-foreground italic text-center py-8">
          Aucune bibliothèque ne correspond aux filtres.
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {filtered.map((lib) => (
            <MediaLibraryCard
              key={lib.id}
              lib={lib}
              detailHref={`${detailBasePath}/${lib.id}`}
              canManage={canManageLibraries}
              onDelete={() => void handleDelete(lib.id, lib.name)}
              // Prop optionnelle : ne pas la passer désactive tout le drag-drop
              // de la card (handlers + surbrillance) sans autre changement.
              onFilesDropped={
                canManageAssets ? (files) => setDropTarget({ lib, files }) : undefined
              }
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

              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Tags, description, rotation et champs personnalisés sont éditables
                ensuite via le bouton <span className="font-semibold">Réglages</span> sur la card.
              </p>

              {createError && (
                <p className="text-[11px] text-danger-700">{createError}</p>
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
  canManage = false,
  onDelete,
  onFilesDropped,
  onOpenSettings,
}: {
  lib: MediaLibrary;
  /** Phase β — href dynamique selon type (/admin/libraries/media/[id] ou /admin/libraries/audio/[id]). */
  detailHref: string;
  /** Actions library-level (réglages / suppression). Masquées si false (ex: VIDEASTE). */
  canManage?: boolean;
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
        "",
        dragOver
          ? "ring-2 ring-success-200 scale-[1.015]"
          : "hover: hover:-translate-y-0.5",
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
              ? "bg-gradient-to-br from-info-100 via-info-50 to-white"
              : "bg-gradient-to-br from-success-100 via-success-50 to-white",
          ].join(" ")}
        >
          <div className="absolute inset-0 flex items-center justify-center opacity-30">
            {isVideo ? <Video size={64} className="text-info-600" /> : <Music2 size={64} className="text-success-600" />}
          </div>
        </div>
      )}

      {/* Voile gradient bottom — assure lisibilité du titre + meta sur n'importe quel cover. */}
      <div className="absolute inset-x-0 bottom-0 h-[60%] bg-gradient-to-t from-gray-950/90 via-gray-950/60 to-transparent pointer-events-none" />

      {/* Badge type + count en haut-left, glass subtle. */}
      <div className="absolute top-3 left-3 inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-card border border-border text-[10.5px] font-medium text-foreground ">
        {isVideo ? <Video size={11} className="text-info-600" /> : <Music2 size={11} className="text-success-600" />}
        <span className="tabular-nums">{lib._count.assets}</span>
      </div>

      {/* Actions au hover top-right — glass icons. Library-level → ADMIN uniquement. */}
      {canManage && (
        <div className="absolute top-3 right-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity z-10">
          {onOpenSettings && (
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onOpenSettings(); }}
              title="Réglages"
              className="h-7 w-7 inline-flex items-center justify-center rounded-md bg-card border border-border text-foreground hover:text-foreground hover:bg-white "
            >
              <Settings2 size={12} />
            </button>
          )}
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(); }}
            title="Supprimer"
            className="h-7 w-7 inline-flex items-center justify-center rounded-md bg-card border border-border text-muted-foreground hover:text-danger-600 hover:bg-white "
          >
            <Trash2 size={12} />
          </button>
        </div>
      )}

      {/* Titre + meta en bas — par-dessus le voile. */}
      <div className="absolute inset-x-0 bottom-0 p-3 z-[5] flex flex-col gap-1.5">
        <h3 className="text-[15px] sm:text-[17px] font-semibold tracking-tight text-white leading-[1.15] drop-shadow-[0_1px_2px_rgba(0,0,0,0.3)] line-clamp-2">
          {lib.name}
        </h3>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tags.slice(0, 2).map((tag) => (
              <span key={tag} className="inline-flex items-center px-1.5 py-0.5 rounded text-[9.5px] font-medium bg-card border border-border text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)]">
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
            {lib.rotationMode === "none" ? "Tirage manuel" : "Tirage par dossier"}
          </span>
          <span className="text-white/40">·</span>
          <span>{rotationScopeLabel(lib.rotationScope)}</span>
        </div>
      </div>

      {/* Drag-drop overlay (par-dessus tout). */}
      {dragOver && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-success-50/85 rounded-2xl pointer-events-none">
          <div className="flex flex-col items-center gap-2 text-success-700">
            <Upload size={28} />
            <span className="text-[12.5px] font-semibold text-center px-3">Déposer dans « {lib.name} »</span>
          </div>
        </div>
      )}

      <span className="sr-only">Voir les fichiers · {lib._count.assets} fichier{lib._count.assets !== 1 ? "s" : ""}</span>
    </Link>
  );
}
