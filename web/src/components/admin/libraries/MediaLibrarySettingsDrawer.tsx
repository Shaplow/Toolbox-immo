"use client";

/**
 * MediaLibrarySettingsDrawer — drawer side-right pour éditer une MediaLibrary
 * sans exposer le JSON.
 *
 * Plan simplification Phase 3 (2026-08) : le mode « Ordre fixe » (setSequence +
 * curseurs) et les catégories sont décommissionnés. Sections restantes :
 *  1. Identité : nom, description, tags.
 *  2. Tirage : switch auto/aucun + portée (par compte / partagé) + burn-once.
 *  3. Champs personnalisés : éditeur structuré key+label+type.
 *  4. Nettoyage : détacher dossiers / tags en masse.
 *
 * Save via PATCH /api/admin/libraries/media/[id] (endpoint existant inchangé).
 */

import { useCallback, useState, useEffect, useMemo, useRef } from "react";
import { Drawer } from "@/components/ui/Drawer";
import { BackfillPostersButton } from "./BackfillPostersButton";
import { Button } from "@/components/ui/Button";
import { Tabs } from "@/components/ui/Tabs";
import { useConfirm } from "@/components/ui/useConfirm";
import { resolveRotationMode } from "@/lib/rotation/rotationMode";
import { toast } from "@/components/ui/Toast";
import {
  FolderOpen,
  ListTree,
  RotateCw,
  Settings2,
  SlidersHorizontal,
  Tag,
  X,
} from "lucide-react";
import type { CustomField } from "@/lib/customFields";
import { normalizeCustomFields, validateCustomFields } from "@/lib/customFields";
import { CustomFieldsSchemaEditor } from "@/components/fields/CustomFieldsSchemaEditor";
import { LibraryIdentitySection } from "./shared/LibraryIdentitySection";
import { RotationSettingsSection } from "./shared/RotationSettingsSection";

interface LibrarySettings {
  id: string;
  type?: "video" | "audio";
  name: string;
  description: string | null;
  tags: string;            // JSON string[]
  rotationScope?: string | null;  // "per_account" | "shared"
  rotationMode?: string | null; // "auto" | "none" | legacy ("override"/null → auto)
  metadataSchema?: string; // JSON MetadataField[]
  maxUsageCount?: number | null; // null = rotation infinie, N ≥ 1 = burn-once
}

interface Props {
  open: boolean;
  onClose: () => void;
  library: LibrarySettings | null;
  onUpdated: () => void | Promise<void>;
}

function parseStringArray(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

export function MediaLibrarySettingsDrawer({ open, onClose, library, onUpdated }: Props) {
  const initialTags = useMemo(() => parseStringArray(library?.tags), [library?.tags]);
  const initialMeta = useMemo(() => normalizeCustomFields(library?.metadataSchema), [library?.metadataSchema]);

  const [name, setName] = useState(library?.name ?? "");
  const [description, setDescription] = useState(library?.description ?? "");
  const [tagsCsv, setTagsCsv] = useState(initialTags.join(", "));
  const [rotationMode, setRotationMode] = useState<"auto" | "none">(
    resolveRotationMode({ rotationMode: library?.rotationMode ?? null }).mode,
  );
  const [rotationScope, setRotationScope] = useState<"per_account" | "shared">(
    library?.rotationScope === "shared" ? "shared" : "per_account",
  );
  const [metadataFields, setMetadataFields] = useState<CustomField[]>(initialMeta);
  // Burn-once : null = rotation infinie, sinon entier ≥ 1
  const [maxUsageCount, setMaxUsageCount] = useState<string>(
    library?.maxUsageCount != null ? String(library.maxUsageCount) : "",
  );
  const [saving, setSaving] = useState(false);
  // Défense — dirty-tracking description/tags : la route PATCH applique un
  // champ dès qu'il est présent dans le body (partial update, cf.
  // `body.description !== undefined`). On snapshotte ici les valeurs reçues
  // du caller à l'ouverture/au changement de `library`, et handleSave n'inclut
  // description/tags dans le payload que s'ils diffèrent de ce snapshot. Ça
  // empêche un caller qui passerait par erreur des valeurs par défaut (ex:
  // description: null / tags: "[]" en dur) d'écraser silencieusement la vraie
  // valeur tant que l'admin n'a pas lui-même édité l'onglet Identité.
  const baselineRef = useRef<{ description: string; tags: string[] } | null>(null);
  type TabKey = "identity" | "rotation" | "fields" | "cleanup";
  const [tab, setTab] = useState<TabKey>("identity");
  // Taxonomies (Dossiers / Tags) chargées au open du drawer.
  type TaxItem = { value: string; count: number };
  const [taxonomies, setTaxonomies] = useState<{ packs: TaxItem[]; tags: TaxItem[] } | null>(null);
  const [taxLoading, setTaxLoading] = useState(false);
  const { confirm, dialog: confirmDialog } = useConfirm();

  const loadTaxonomies = useCallback(async () => {
    if (!library) return;
    setTaxLoading(true);
    try {
      const res = await fetch(`/api/admin/libraries/media/${library.id}/taxonomies`);
      if (!res.ok) return;
      const data = (await res.json()) as { packs: TaxItem[]; tags: TaxItem[] };
      setTaxonomies(data);
    } catch {
      /* ignore */
    } finally {
      setTaxLoading(false);
    }
  }, [library]);

  useEffect(() => {
    if (open && library) {
      void loadTaxonomies();
    }
  }, [open, library, loadTaxonomies]);

  async function handleDetach(type: "pack" | "tag", value: string, count: number) {
    if (!library) return;
    const labels = {
      pack: { sing: "dossier" },
      tag: { sing: "tag" },
    }[type];
    const ok = await confirm({
      title: `Supprimer le ${labels.sing} « ${value} » ?`,
      description: `${count} plan${count > 1 ? "s" : ""} ${count > 1 ? "vont" : "va"} perdre ce ${labels.sing}. Les plans restent intacts mais sans ce ${labels.sing}.`,
      confirmLabel: "Détacher",
      variant: "danger",
    });
    if (!ok) return;
    try {
      const res = await fetch(
        `/api/admin/libraries/media/${library.id}/taxonomies?type=${type}&value=${encodeURIComponent(value)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(d.error ?? "Erreur lors du détachage");
        return;
      }
      toast.success(`${labels.sing.charAt(0).toUpperCase() + labels.sing.slice(1)} « ${value} » détaché de ${count} plan${count > 1 ? "s" : ""}`);
      await loadTaxonomies();
      await onUpdated();
    } catch {
      toast.error("Erreur réseau");
    }
  }

  // Re-sync states quand library change (drawer opened for another lib).
  useEffect(() => {
    if (library) {
      const initDescription = library.description ?? "";
      setName(library.name);
      setDescription(initDescription);
      const t = parseStringArray(library.tags);
      setTagsCsv(t.join(", "));
      setRotationMode(resolveRotationMode({ rotationMode: library.rotationMode ?? null }).mode);
      setRotationScope(library.rotationScope === "shared" ? "shared" : "per_account");
      setMetadataFields(normalizeCustomFields(library.metadataSchema));
      setMaxUsageCount(library.maxUsageCount != null ? String(library.maxUsageCount) : "");
      baselineRef.current = { description: initDescription, tags: t };
    }
  }, [library]);

  if (!library) return null;

  async function handleSave() {
    if (!library) return;
    if (!name.trim()) {
      toast.error("Le nom est requis");
      return;
    }
    // Validate metadata keys via le validateur canonique.
    const metaError = validateCustomFields(metadataFields);
    if (metaError) {
      toast.error(metaError);
      return;
    }
    // Parse maxUsageCount : vide → null, sinon entier ≥ 1
    const trimmedMax = maxUsageCount.trim();
    let parsedMax: number | null;
    if (trimmedMax === "") {
      parsedMax = null;
    } else {
      const n = Number(trimmedMax);
      if (!Number.isInteger(n) || n < 1) {
        toast.error("Consommation max : laisser vide pour infini, sinon un entier ≥ 1");
        return;
      }
      parsedMax = n;
    }
    setSaving(true);
    try {
      const tagsList = tagsCsv.split(",").map((t) => t.trim()).filter(Boolean);
      const trimmedDescription = description.trim();
      const payload: Record<string, unknown> = {
        name: name.trim(),
        rotationScope,
        rotationMode,
        maxUsageCount: parsedMax,
        metadataSchema: metadataFields.map((f) => ({
          key: f.key.trim(),
          label: f.label.trim(),
          type: f.type,
        })),
      };
      // Dirty-tracking (cf. baselineRef ci-dessus) : la route ignore un champ
      // absent du body, donc on ne l'inclut que s'il a réellement changé.
      const baseline = baselineRef.current;
      if (!baseline || trimmedDescription !== baseline.description) {
        payload.description = trimmedDescription || null;
      }
      if (!baseline || JSON.stringify(tagsList) !== JSON.stringify(baseline.tags)) {
        // Tableau brut : la route le sérialise elle-même. Envoyer une string
        // ici le faisait silencieusement ignorer côté serveur.
        payload.tags = tagsList;
      }
      const res = await fetch(`/api/admin/libraries/media/${library.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(d.error ?? "Erreur lors de la sauvegarde");
        return;
      }
      toast.success(`Bibliothèque « ${name.trim()} » mise à jour`);
      await onUpdated();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer open={open} onClose={onClose} side="right" size="lg">
      <Drawer.Header onClose={onClose}>
        <span className="inline-flex items-center gap-2">
          <Settings2 size={14} className="text-muted-foreground" />
          Réglages — {library.name}
        </span>
      </Drawer.Header>
      <Drawer.Body className="space-y-4">
        <Tabs
          variant="line"
          size="sm"
          value={tab}
          onChange={(id) => setTab(id as TabKey)}
          items={[
            { id: "identity", label: "Identité", icon: Settings2 },
            { id: "rotation", label: "Tirage", icon: RotateCw },
            { id: "fields", label: "Champs perso", icon: SlidersHorizontal },
            { id: "cleanup", label: "Nettoyage", icon: ListTree },
          ]}
        />

        {tab === "identity" && (
          <LibraryIdentitySection
            name={name}
            onNameChange={setName}
            namePlaceholder="Ex: Rush RPI Paris"
            description={description}
            onDescriptionChange={setDescription}
            descriptionRows={2}
            tags={{ value: tagsCsv, onChange: setTagsCsv }}
          />
        )}

        {tab === "rotation" && (
          <RotationSettingsSection
            mode={rotationMode}
            onModeChange={setRotationMode}
            scope={rotationScope}
            onScopeChange={setRotationScope}
            maxUsageCount={maxUsageCount}
            onMaxUsageCountChange={setMaxUsageCount}
            turnoverLabel="Comment ils tournent"
            unit={{ singular: "asset" }}
            modeHelp={{
              auto: "Toolbox pioche dans le dossier servi le moins récemment, puis le plan le moins récemment utilisé dedans. Les plans d'un même dossier (ex : intro + outro filmées ensemble) sortent ensemble.",
              none: "Pas de tirage auto. La sélection se fait via un champ du formulaire de génération (metadata) — vous choisissez vous-même quel plan utiliser.",
            }}
            maxUsageHelp={{
              per_account: "Laisser vide = rotation infinie. Sinon, chaque compte voit chaque asset max N fois avant qu'il sorte de la rotation pour ce compte.",
              shared: "Laisser vide = rotation infinie. Sinon, chaque asset est utilisé max N fois au total (tous comptes confondus) avant d'être retiré.",
            }}
          />
        )}

        {tab === "fields" && (
        <section className="rounded-2xl bg-card border border-border p-4  space-y-2">
          <h3 className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground">
            Champs personnalisés
          </h3>
          <p className="text-[11px] text-muted-foreground italic">
            Ajoute des champs comme « propriétaire », « prix », « lien »…
          </p>
          <CustomFieldsSchemaEditor
            fields={metadataFields}
            onChange={setMetadataFields}
          />
        </section>
        )}

        {tab === "cleanup" && (
        <section className="rounded-2xl bg-card border border-border p-4  space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground inline-flex items-center gap-1.5">
              <ListTree size={11} /> Nettoyage
            </h3>
            <button
              type="button"
              onClick={() => void loadTaxonomies()}
              disabled={taxLoading}
              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              title="Rafraîchir"
            >
              {taxLoading ? "…" : "↻"}
            </button>
          </div>
          <p className="text-[10.5px] text-muted-foreground leading-relaxed">
            Supprime un dossier ou un tag de tous les plans concernés en un clic. Les plans ne sont pas supprimés — ils perdent juste cette étiquette.
          </p>
          {taxonomies && (
            <div className="space-y-2.5">
              <TaxonomyList
                label="Dossiers"
                icon={FolderOpen}
                items={taxonomies.packs}
                onDetach={(value, count) => void handleDetach("pack", value, count)}
              />
              <TaxonomyList
                label="Tags"
                icon={Tag}
                items={taxonomies.tags}
                onDetach={(value, count) => void handleDetach("tag", value, count)}
              />
            </div>
          )}
          {library?.type === "video" && (
            <div className="pt-3 mt-1 border-t border-border space-y-2">
              <h4 className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground">
                Vignettes
              </h4>
              <p className="text-[10.5px] text-muted-foreground leading-relaxed">
                Les vidéos sans vignette chargent leur fichier entier pour l&apos;aperçu (lent).
                Génère les posters manquants pour accélérer l&apos;affichage.
              </p>
              <BackfillPostersButton libraryId={library.id} />
            </div>
          )}
        </section>
        )}
      </Drawer.Body>
      <Drawer.Footer>
        <Button variant="ghost" onClick={onClose} disabled={saving}>
          Annuler
        </Button>
        <Button variant="primary" onClick={handleSave} loading={saving} disabled={!name.trim()}>
          Enregistrer
        </Button>
      </Drawer.Footer>
      {confirmDialog}
    </Drawer>
  );
}

// ─── Sub-composants ────────────────────────────────────────────────────────

function TaxonomyList({
  label,
  icon: Icon,
  items,
  onDetach,
}: {
  label: string;
  icon: typeof Tag;
  items: { value: string; count: number }[];
  onDetach: (value: string, count: number) => void;
}) {
  return (
    <div>
      <p className="text-[9.5px] uppercase tracking-widest font-medium text-muted-foreground mb-1 inline-flex items-center gap-1">
        <Icon size={9} /> {label}
        <span className="text-muted-foreground/60 normal-case tracking-normal font-normal">({items.length})</span>
      </p>
      {items.length === 0 ? (
        <p className="text-[10.5px] text-muted-foreground italic px-1">Aucun.</p>
      ) : (
        <ul className="space-y-0.5">
          {items.map((item) => (
            <li
              key={item.value}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-card border border-border  group/tax"
            >
              <span className="flex-1 min-w-0 text-[11.5px] text-foreground truncate">{item.value}</span>
              <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">{item.count}</span>
              <button
                type="button"
                onClick={() => onDetach(item.value, item.count)}
                className="p-0.5 text-muted-foreground/60 hover:text-danger-600 transition-colors opacity-0 group-hover/tax:opacity-100"
                title="Détacher de tous les plans"
              >
                <X size={11} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
