"use client";

/**
 * MediaAssetDetailDrawer — drawer side-right qui remplace les 20+ inline edits
 * de MediaAssetsVideoCard pour le mode noob.
 *
 * Phase 3 médiathèque (2026-05-30). Plan simplification 2026-08 : le concept
 * de Catégorie a été retiré (le dossier — `setTag` — est la seule notion de
 * rangement). Le drawer expose 3 sections :
 *  1. Rangement (toujours visible) : Dossier via Combobox autocomplete.
 *  2. Tags & filtres (collapsible, fermée par défaut) : chips éditables.
 *  3. Avancé (collapsible) : restreindre à compte(s), champs métadonnées,
 *     désactiver, reset usage, supprimer.
 *
 * Tous les handlers proviennent du hook `useAssetInlineEdits` (passé via prop
 * `inline`) pour mutualiser optimistic update + toast + invalidation.
 *
 * Le footer expose 2 actions : "Modifier le trim" (réutilise MediaAssetEditModal
 * via onOpenTrim) et "Supprimer".
 */

import { useEffect, useMemo, useState } from "react";
import { Drawer } from "@/components/ui/Drawer";
import { Combobox } from "@/components/ui/Combobox";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Input } from "@/components/ui/Input";
import { FormField } from "@/components/ui/FormField";
import { CustomFieldValueInput } from "@/components/fields/CustomFieldValueInput";
import {
  FolderOpen,
  Layers,
  Tag,
  Scissors,
  Trash2,
  Power,
  RotateCcw,
  Plus,
  ChevronDown,
  Info,
  Download,
} from "lucide-react";
import type { InstagramAccount, MediaAsset, MetadataField } from "./types";
import type { UseAssetInlineEditsResult } from "./useAssetInlineEdits";
import { downloadAsset } from "./downloadAssets";
import { useMediaLibraryPermissions } from "./mediaLibraryPermissions";
import { isReservedSetTag } from "@/lib/rotation/sentinels";

interface Props {
  open: boolean;
  onClose: () => void;
  asset: MediaAsset | null;
  metadataSchema: MetadataField[];
  existingPacks: string[];
  accounts: InstagramAccount[];
  inline: UseAssetInlineEditsResult;
  onOpenTrim?: (asset: MediaAsset) => void;
  /** Si fournie : autres assets du même set, pour permettre de naviguer entre les vidéos d'un pack
      sans fermer/rouvrir le drawer. La liste contient l'asset courant + ses voisins. */
  setAssets?: MediaAsset[];
  /** Callback pour switcher l'asset affiché (utile avec setAssets). */
  onSwitchAsset?: (asset: MediaAsset) => void;
}

export function MediaAssetDetailDrawer({
  open,
  onClose,
  asset,
  metadataSchema,
  existingPacks,
  accounts,
  inline,
  onOpenTrim,
  setAssets,
  onSwitchAsset,
}: Props) {
  const { canManageAssets } = useMediaLibraryPermissions();
  // États locaux contrôlés pour les inputs — sync sur asset change.
  const [packInput, setPackInput] = useState("");
  const [tagDraft, setTagDraft] = useState("");

  useEffect(() => {
    if (asset) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPackInput(asset.setTag ?? "");
      setTagDraft("");
    }
  }, [asset]);

  const packOptions = useMemo(
    () => existingPacks.map((p) => ({ value: p, label: p, icon: Layers })),
    [existingPacks],
  );

  if (!asset) return null;
  const isVideo = asset.mimeType.startsWith("video/");

  async function addTag() {
    if (!asset) return;
    const t = tagDraft.trim();
    if (!t) return;
    if (asset.tags.includes(t)) {
      setTagDraft("");
      return;
    }
    await inline.handleSaveTags(asset, [...asset.tags, t]);
    setTagDraft("");
  }
  async function removeTag(tag: string) {
    if (!asset) return;
    await inline.handleSaveTags(asset, asset.tags.filter((t) => t !== tag));
  }

  const isRestricted = asset.accessAccountIds.length > 0;

  return (
    <Drawer open={open} onClose={onClose} side="right" size="lg">
      <Drawer.Header onClose={onClose}>Détails du fichier</Drawer.Header>
      <Drawer.Body className="space-y-4">
        {/* Navigateur entre les assets du set — uniquement si setAssets fourni (> 1). */}
        {setAssets && setAssets.length > 1 && onSwitchAsset && (
          <div className="rounded-xl bg-card border border-border px-3 py-2 ">
            <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-1.5 inline-flex items-center gap-1">
              <Layers size={10} />
              Vidéos du groupe
              <span className="font-normal normal-case tracking-normal text-muted-foreground">({setAssets.length})</span>
            </p>
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin]">
              {setAssets.map((a, idx) => {
                const isCurrent = a.id === asset.id;
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => onSwitchAsset(a)}
                    title={a.filename}
                    className={[
                      "shrink-0 h-12 w-9 rounded-md overflow-hidden bg-gray-200 relative transition-all",
                      isCurrent
                        ? "ring-2 ring-info-200 ring-offset-1 ring-offset-white scale-105"
                        : "ring-1 ring-gray-200 hover:ring-gray-400",
                    ].join(" ")}
                  >
                    <video src={`${a.url}#t=0.5`} muted preload="metadata" className="h-full w-full object-cover" />
                    <span className={`absolute bottom-0.5 right-0.5 text-[8px] font-mono tabular-nums px-1 rounded ${isCurrent ? "bg-info-600 text-white" : "bg-black/60 text-white"}`}>
                      {idx + 1}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Aperçu média — surface noire OK (média = noir naturel), ring spéculaire glass. */}
        <div className="rounded-2xl overflow-hidden bg-gray-900/95 ">
          {isVideo ? (
            <video
              src={asset.url}
              controls
              className="w-full max-h-[280px] object-contain bg-black"
            />
          ) : (
            <audio src={asset.url} controls className="w-full" />
          )}
        </div>

        {/* Filename + meta — glass tight card */}
        <div className="rounded-xl bg-card border border-border px-3 py-2.5 ">
          <p className="text-[13.5px] font-semibold text-foreground truncate" title={asset.filename}>
            {asset.filename}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
            {asset.duration && <span>{asset.duration.toFixed(1)}s</span>}
            <span className="text-muted-foreground/60">·</span>
            <span>{(asset.mimeType || "").split("/")[1]?.toUpperCase() || "?"}</span>
            <span className="text-muted-foreground/60">·</span>
            <span>
              Utilisé {asset.usageCount} fois{asset.lastUsedAt ? ` · ${new Date(asset.lastUsedAt).toLocaleDateString("fr-FR")}` : ""}
            </span>
          </p>
        </div>

        {/* Rangement — en lecture seule, on affiche les mêmes informations sans
            aucun contrôle éditable : le monteur a besoin de savoir à quel dossier
            appartient un plan, pas de pouvoir le changer. */}
        {!canManageAssets ? (
          <section className="rounded-2xl bg-card border border-border p-4 space-y-2">
            <h3 className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground inline-flex items-center gap-1.5">
              <FolderOpen size={11} /> Rangement
            </h3>
            <p className="text-[12px] text-foreground">
              <span className="text-muted-foreground">Dossier : </span>
              {asset.setTag && !isReservedSetTag(asset.setTag)
                ? asset.setTag
                : <span className="text-muted-foreground italic">aucun</span>}
            </p>
            <p className="text-[12px] text-foreground">
              <span className="text-muted-foreground">Tags : </span>
              {asset.tags.length > 0
                ? asset.tags.join(", ")
                : <span className="text-muted-foreground italic">aucun</span>}
            </p>
          </section>
        ) : (
        <section className="rounded-2xl bg-card border border-border p-4 space-y-3">
          <h3 className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground inline-flex items-center gap-1.5">
            <FolderOpen size={11} /> Rangement
          </h3>
          <FormField
            label="Dossier"
            help="Plans qui voyagent ensemble dans le même rendu (intro + outro par exemple)."
          >
            <div className="flex gap-2">
              <Combobox
                value={packInput}
                onChange={(v) => {
                  setPackInput(v);
                  if (asset && v !== (asset.setTag ?? "")) {
                    void inline.handleSaveSetTag(asset, v.trim());
                  }
                }}
                options={packOptions}
                allowCustom
                placeholder="Choisir ou créer un dossier…"
                emptyMessage="Aucun dossier. Tapez un nom pour en créer un."
              />
            </div>
          </FormField>
        </section>
        )}

        {/* Tags & filtres — collapsible (glass card). Les tags sont déjà
            listés dans le bloc « Rangement » en lecture seule. */}
        {canManageAssets && (
        <details className="group rounded-2xl bg-card border border-border  overflow-hidden" {...(asset.tags.length > 0 ? { open: true } : {})}>
          <summary className="cursor-pointer flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-semibold text-muted-foreground hover:text-foreground hover:bg-white/40 select-none px-4 py-3 transition-colors">
            <Tag size={11} /> Tags & filtres
            <span className="text-[10px] text-muted-foreground font-normal normal-case tracking-normal">
              ({asset.tags.length})
            </span>
            <ChevronDown size={12} className="ml-auto transition-transform group-open:rotate-180" />
          </summary>
          <div className="px-4 pb-4 space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {asset.tags.map((t) => (
                <Chip key={t} variant="sky" size="sm" onRemove={() => void removeTag(t)}>
                  {t}
                </Chip>
              ))}
              {asset.tags.length === 0 && (
                <span className="text-[11px] text-muted-foreground italic">Aucun tag</span>
              )}
            </div>
            <div className="flex gap-2">
              <Input
                value={tagDraft}
                onChange={setTagDraft}
                placeholder="Ajouter un tag…"
              />
              <Button
                variant="secondary"
                size="sm"
                icon={Plus}
                onClick={() => void addTag()}
                disabled={!tagDraft.trim()}
              >
                Ajouter
              </Button>
            </div>
          </div>
        </details>
        )}

        {/* Avancé — collapsible (glass card, fermée par défaut). Entièrement
            composé de contrôles mutants : rien à montrer en lecture seule. */}
        {canManageAssets && (
        <details className="group rounded-2xl bg-card border border-border  overflow-hidden">
          <summary className="cursor-pointer flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-semibold text-muted-foreground hover:text-foreground hover:bg-white/40 select-none px-4 py-3 transition-colors">
            <Info size={11} /> Avancé
            <ChevronDown size={12} className="ml-auto transition-transform group-open:rotate-180" />
          </summary>
          <div className="px-4 pb-4 pt-1 space-y-4">
            {/* Accès comptes */}
            {accounts.length > 0 && (
              <FormField
                label="Restreindre à un compte"
                help={isRestricted ? "Cet asset n'est visible que par les comptes listés." : "Cet asset est global (tous les comptes)."}
              >
                <div className="flex flex-wrap gap-1.5">
                  {accounts.map((acc) => {
                    const hasAccess = asset.accessAccountIds.includes(acc.id);
                    return (
                      <Chip
                        key={acc.id}
                        variant={hasAccess ? "sky" : "default"}
                        selected={hasAccess}
                        size="sm"
                        onClick={() => {
                          if (asset) void inline.handleToggleAccess(asset, acc.id, !hasAccess);
                        }}
                      >
                        @{acc.handle}
                      </Chip>
                    );
                  })}
                </div>
              </FormField>
            )}

            {/* Metadata schema */}
            {metadataSchema.length > 0 && (
              <FormField label="Champs personnalisés">
                <div className="space-y-2">
                  {metadataSchema.map((field) => {
                    const value = (asset.metadata?.[field.key] ?? "") as string | number;
                    return (
                      <div key={field.key} className="flex items-center gap-2">
                        <span className="text-[11px] text-muted-foreground w-24 shrink-0 truncate" title={field.label}>
                          {field.label}
                        </span>
                        <div className="flex-1 min-w-0">
                          <CustomFieldValueInput
                            field={field}
                            value={String(value)}
                            onChange={(v) => {
                              if (asset) void inline.handleSaveMetadata(asset, field.key, v);
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </FormField>
            )}

            {/* Disabled toggle */}
            <FormField label="État" help={asset.disabled ? "Asset désactivé — exclu de la rotation." : "Asset actif — disponible pour la rotation."}>
              <Chip
                variant={asset.disabled ? "rose" : "sage"}
                selected
                icon={Power}
                size="sm"
                onClick={() => {
                  if (asset) void inline.handleToggleDisabled(asset);
                }}
              >
                {asset.disabled ? "Réactiver" : "Désactiver"}
              </Chip>
            </FormField>

            {/* Reset usage */}
            <FormField label="Compteurs d'usage">
              <Button
                variant="ghost"
                size="sm"
                icon={RotateCcw}
                onClick={() => {
                  if (asset) void inline.handleResetAssetUsage(asset);
                }}
              >
                Réinitialiser usageCount + lastUsedAt
              </Button>
            </FormField>

            {/* Modifier (trim) déplacé en avancé — édition vidéo type power-user. */}
            {onOpenTrim && isVideo && (
              <FormField label="Édition vidéo">
                <Button
                  variant="secondary"
                  size="sm"
                  icon={Scissors}
                  onClick={() => {
                    if (asset && onOpenTrim) onOpenTrim(asset);
                  }}
                >
                  Modifier (trim, crop, FX)
                </Button>
              </FormField>
            )}
          </div>
        </details>
        )}
      </Drawer.Body>
      <Drawer.Footer>
        <Button
          variant={canManageAssets ? "secondary" : "default"}
          size="sm"
          icon={Download}
          onClick={() => {
            if (asset) void downloadAsset({ id: asset.id, filename: asset.filename });
          }}
        >
          Télécharger
        </Button>
        <div className="flex-1" />
        {canManageAssets && (
        <Button
          variant="danger"
          size="sm"
          icon={Trash2}
          onClick={async () => {
            if (!asset) return;
            await inline.handleDelete(asset);
            onClose();
          }}
        >
          Supprimer
        </Button>
        )}
      </Drawer.Footer>
    </Drawer>
  );
}
