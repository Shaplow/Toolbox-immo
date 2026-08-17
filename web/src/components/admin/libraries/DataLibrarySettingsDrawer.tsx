"use client";

/**
 * DataLibrarySettingsDrawer — drawer side-right pour éditer une DataLibrary
 * sans exposer le JSON.
 *
 * Plan simplification Phase 4 (2026-08) : aligné sur MediaLibrarySettingsDrawer
 * refondu (Phase 3) — le mode « Ordre fixe » et les policies de campagne
 * (cycle/once × account/global) sont décommissionnés. Sections :
 *  1. Identité : nom, description.
 *  2. Tirage : switch auto/aucun + portée (par compte / partagé) + consommation max.
 *  3. Champs personnalisés : éditeur structuré key+label+type+required.
 *  4. Lien public : génère/révoque le lien de remplissage externe.
 *
 * Save via PATCH /api/admin/libraries/data/[id].
 */

import { useState, useEffect, useMemo } from "react";
import { Drawer } from "@/components/ui/Drawer";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Input } from "@/components/ui/Input";
import { Tabs } from "@/components/ui/Tabs";
import { Textarea } from "@/components/ui/Textarea";
import { FormField } from "@/components/ui/FormField";
import { resolveRotationMode } from "@/lib/rotation/rotationMode";

import { toast } from "@/components/ui/Toast";
import { Copy, Link2, RefreshCw, RotateCw, Settings2, SlidersHorizontal, Trash2 } from "lucide-react";
import type { CustomField } from "@/lib/customFields";
import { normalizeCustomFields, validateCustomFields } from "@/lib/customFields";
import { CustomFieldsSchemaEditor } from "@/components/fields/CustomFieldsSchemaEditor";

interface DataLibrarySettings {
  id: string;
  name: string;
  description: string | null;
  rotationMode?: string | null; // "auto" | "none" | legacy ("override"/null → auto)
  rotationScope: "shared" | "per_account";
  maxUsageCount: number | null;
  fieldsSchema: string; // JSON FieldDef[]
  publicFillToken: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  library: DataLibrarySettings | null;
  onUpdated: () => void | Promise<void>;
}

export function DataLibrarySettingsDrawer({ open, onClose, library, onUpdated }: Props) {
  const initialSchema = useMemo(() => normalizeCustomFields(library?.fieldsSchema), [library?.fieldsSchema]);

  const [name, setName] = useState(library?.name ?? "");
  const [description, setDescription] = useState(library?.description ?? "");
  const [rotationMode, setRotationMode] = useState<"auto" | "none">(
    resolveRotationMode({ rotationMode: library?.rotationMode ?? null }).mode,
  );
  const [rotationScope, setRotationScope] = useState<"per_account" | "shared">(
    library?.rotationScope === "shared" ? "shared" : "per_account",
  );
  // Consommation max : null = rotation infinie, sinon entier ≥ 1 (soft cap N).
  const [maxUsageCount, setMaxUsageCount] = useState<string>(
    library?.maxUsageCount != null ? String(library.maxUsageCount) : "",
  );
  const [fields, setFields] = useState<CustomField[]>(initialSchema);
  const [saving, setSaving] = useState(false);
  type TabKey = "identity" | "rotation" | "fields" | "share";
  const [tab, setTab] = useState<TabKey>("identity");
  // Phase 1.x Vague 3 — token de remplissage public.
  const [publicToken, setPublicToken] = useState<string | null>(library?.publicFillToken ?? null);
  const [tokenLoading, setTokenLoading] = useState(false);

  // Re-sync local state quand la lib cible change.
  useEffect(() => {
    if (!library) return;
    setName(library.name);
    setDescription(library.description ?? "");
    setRotationMode(resolveRotationMode({ rotationMode: library.rotationMode ?? null }).mode);
    setRotationScope(library.rotationScope === "shared" ? "shared" : "per_account");
    setMaxUsageCount(library.maxUsageCount != null ? String(library.maxUsageCount) : "");
    setFields(normalizeCustomFields(library.fieldsSchema));
    setPublicToken(library.publicFillToken ?? null);
  }, [library]);

  async function generateToken() {
    if (!library) return;
    setTokenLoading(true);
    try {
      const res = await fetch(`/api/admin/libraries/data/${library.id}/public-fill-token`, {
        method: "POST",
      });
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        toast.error(d.error ?? "Erreur lors de la génération");
        return;
      }
      const data = (await res.json()) as { token: string };
      setPublicToken(data.token);
      toast.success("Lien généré.");
    } catch (err) {
      console.error("[DataLibrarySettingsDrawer] generate token error:", err);
      toast.error("Erreur réseau");
    } finally {
      setTokenLoading(false);
    }
  }

  async function revokeToken() {
    if (!library) return;
    setTokenLoading(true);
    try {
      const res = await fetch(`/api/admin/libraries/data/${library.id}/public-fill-token`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        toast.error(d.error ?? "Erreur lors de la révocation");
        return;
      }
      setPublicToken(null);
      toast.success("Lien révoqué.");
    } finally {
      setTokenLoading(false);
    }
  }

  async function copyPublicUrl() {
    if (!publicToken) return;
    const url = `${window.location.origin}/data-fill/${publicToken}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Lien copié dans le presse-papier.");
    } catch {
      toast.error("Impossible de copier — sélectionne le lien manuellement.");
    }
  }

  if (!library) return null;

  async function handleSave() {
    if (!library) return;
    if (!name.trim()) {
      toast.error("Le nom est requis");
      return;
    }
    // Validation locale du schéma avant envoi (l'API revalide aussi).
    const schemaError = validateCustomFields(fields);
    if (schemaError) {
      toast.error(schemaError);
      return;
    }
    const reserved = ["set_tag", "category"];
    const reservedHit = fields.find((f) => reserved.includes(f.key.toLowerCase()));
    if (reservedHit) {
      toast.error(`« ${reservedHit.key} » est réservé (ajouté automatiquement)`);
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
      const res = await fetch(`/api/admin/libraries/data/${library.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          rotationMode,
          rotationScope,
          maxUsageCount: parsedMax,
          fieldsSchema: fields,
        }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        toast.error(data.error ?? "Erreur lors de la sauvegarde");
        return;
      }
      toast.success(`Bibliothèque « ${name.trim()} » mise à jour`);
      await onUpdated();
      onClose();
    } catch (err) {
      console.error("[DataLibrarySettingsDrawer] save error:", err);
      toast.error("Erreur réseau");
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
            { id: "share", label: "Lien public", icon: Link2 },
          ]}
        />

        {tab === "identity" && (
        <section className="rounded-2xl bg-card border border-border p-4  space-y-3">
          <h3 className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground">
            Identité
          </h3>
          <FormField label="Nom" required>
            <Input value={name} onChange={setName} placeholder="Nom de la bibliothèque" />
          </FormField>
          <FormField label="Description (optionnel)">
            <Textarea
              value={description}
              onChange={setDescription}
              rows={3}
              placeholder="À quoi sert cette bibliothèque…"
            />
          </FormField>
        </section>
        )}

        {tab === "rotation" && (
        <section className="rounded-2xl bg-card border border-border p-4  space-y-3">
          <h3 className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground inline-flex items-center gap-1.5">
            <RotateCw size={11} /> Tirage
          </h3>
          <FormField label="Tirage automatique">
            <div className="flex gap-1.5 flex-wrap">
              {(["auto", "none"] as const).map((m) => (
                <Chip
                  key={m}
                  variant={rotationMode === m ? "sky" : "default"}
                  selected={rotationMode === m}
                  onClick={() => setRotationMode(m)}
                  size="sm"
                >
                  {m === "auto" ? "Auto · par dossier" : "Aucun"}
                </Chip>
              ))}
            </div>
            <p className="text-[10.5px] text-muted-foreground mt-1.5 leading-relaxed">
              {rotationMode === "auto"
                ? "Toolbox pioche dans le dossier servi le moins récemment, puis la fiche la moins récemment utilisée dedans."
                : "Pas de tirage auto. La sélection se fait manuellement au moment de la génération."}
            </p>
          </FormField>
          <FormField label="Comment elles tournent" help="Indépendant : chaque compte avance dans son propre cycle. Partagé : tous les comptes consomment le même.">
            <div className="flex gap-1.5">
              {(["per_account", "shared"] as const).map((s) => (
                <Chip
                  key={s}
                  variant={rotationScope === s ? "sky" : "default"}
                  selected={rotationScope === s}
                  onClick={() => setRotationScope(s)}
                  size="sm"
                >
                  {s === "per_account" ? "Indépendant par compte" : "Partagé entre comptes"}
                </Chip>
              ))}
            </div>
          </FormField>
          <FormField
            label="Consommation max par fiche"
            help={
              rotationScope === "per_account"
                ? "Laisser vide = rotation infinie. Sinon, chaque compte voit chaque fiche max N fois avant qu'elle sorte de la rotation pour ce compte."
                : "Laisser vide = rotation infinie. Sinon, chaque fiche est utilisée max N fois au total (tous comptes confondus) avant d'être retirée."
            }
          >
            <Input
              value={maxUsageCount}
              onChange={setMaxUsageCount}
              placeholder="Vide = infini"
              type="number"
            />
          </FormField>
        </section>
        )}

        {tab === "fields" && (
        <section className="rounded-2xl bg-card border border-border p-4  space-y-3">
          <h3 className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground">
            Champs des fiches
          </h3>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Définis les colonnes attendues dans une fiche (ex : <code className="text-[10.5px] bg-muted px-1 rounded">titre</code>, <code className="text-[10.5px] bg-muted px-1 rounded">prix</code>, <code className="text-[10.5px] bg-muted px-1 rounded">surface</code>). Ces champs servent à&nbsp;:
            <br />— générer un modèle CSV propre (même sans fiche existante),
            <br />— construire le formulaire « Nouvelle fiche »,
            <br />— valider les imports.
            <br />La colonne <code className="text-[10.5px] bg-muted px-1 rounded">set_tag</code> est ajoutée automatiquement.
          </p>
          {fields.length > 0 && (
            <p className="text-[10.5px] text-muted-foreground">
              <span className="font-medium">Table</span> = champ visible dans la vue table compacte (max 5 affichés).
              Si rien n&apos;est coché, les 3 premiers champs servent par défaut.
            </p>
          )}
          <CustomFieldsSchemaEditor
            fields={fields}
            onChange={setFields}
            allowRequired
            allowPrimary
            reservedKeys={["set_tag", "category"]}
          />
        </section>
        )}

        {tab === "share" && (
        <section className="rounded-2xl bg-card border border-border p-4  space-y-3">
          <h3 className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground inline-flex items-center gap-1.5">
            <Link2 size={12} /> Lien public de remplissage
          </h3>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Génère un lien que tu peux partager (mail, Slack…) à quelqu&apos;un d&apos;externe.
            Cette personne pourra ajouter des fiches sans avoir besoin d&apos;un compte. Les fiches
            arrivent direct dans la bibliothèque — tu peux les supprimer si besoin.
            <br />Ne diffuse le lien qu&apos;aux personnes de confiance. Tu peux le révoquer à tout moment.
          </p>

          {publicToken ? (
            <div className="space-y-2">
              <div className="rounded-lg bg-card border border-border px-2.5 py-2  flex items-center gap-2">
                <input
                  readOnly
                  value={typeof window !== "undefined" ? `${window.location.origin}/data-fill/${publicToken}` : `…/data-fill/${publicToken}`}
                  className="flex-1 min-w-0 bg-transparent text-[12px] font-mono text-foreground outline-none"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button
                  type="button"
                  onClick={() => void copyPublicUrl()}
                  className="shrink-0 p-1 text-muted-foreground hover:text-foreground transition-colors"
                  title="Copier"
                >
                  <Copy size={13} />
                </button>
              </div>
              <div className="flex items-center justify-end gap-1.5">
                <Button variant="ghost" size="sm" icon={RefreshCw} onClick={() => void generateToken()} loading={tokenLoading}>
                  Renouveler
                </Button>
                <Button variant="ghost" size="sm" icon={Trash2} onClick={() => void revokeToken()} loading={tokenLoading}>
                  Révoquer
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="secondary" size="sm" icon={Link2} onClick={() => void generateToken()} loading={tokenLoading}>
              Générer un lien
            </Button>
          )}
        </section>
        )}
      </Drawer.Body>
      <Drawer.Footer>
        <div className="flex items-center justify-end gap-2 w-full">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Annuler
          </Button>
          <Button variant="primary" onClick={() => void handleSave()} loading={saving}>
            Enregistrer
          </Button>
        </div>
      </Drawer.Footer>
    </Drawer>
  );
}
