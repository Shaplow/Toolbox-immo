"use client";

/**
 * DataLibrarySettingsDrawer — drawer side-right pour éditer une DataLibrary.
 *
 * Phase 1.x (Légère) — mirror du MediaLibrarySettingsDrawer mais simplifié :
 *  1. Identité : nom, description.
 *  2. Rotation : mode (auto / ordre fixe / aucune) + portée (partagé / par compte) + max usage.
 *  3. Champs : éditeur structuré key+label+type+required pour le schéma des fiches.
 *
 * Save via PATCH /api/admin/libraries/data/[id].
 */

import { useState, useEffect, useMemo } from "react";
import { Drawer } from "@/components/ui/Drawer";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { FormField } from "@/components/ui/FormField";

import { toast } from "@/components/ui/Toast";
import { Copy, Link2, RefreshCw, Settings2, Trash2 } from "lucide-react";
import type { CustomField } from "@/lib/customFields";
import { normalizeCustomFields, validateCustomFields } from "@/lib/customFields";
import { CustomFieldsSchemaEditor } from "@/components/fields/CustomFieldsSchemaEditor";

interface DataLibrarySettings {
  id: string;
  name: string;
  description: string | null;
  rotationMode: "auto" | "override" | "none";
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

// FIELD_TYPE_OPTIONS et parseSchema remplacés par CustomFieldsSchemaEditor + normalizeCustomFields.

export function DataLibrarySettingsDrawer({ open, onClose, library, onUpdated }: Props) {
  const initialSchema = useMemo(() => normalizeCustomFields(library?.fieldsSchema), [library?.fieldsSchema]);

  const [name, setName] = useState(library?.name ?? "");
  const [description, setDescription] = useState(library?.description ?? "");
  const [rotationMode, setRotationMode] = useState<"auto" | "override" | "none">(
    library?.rotationMode ?? "auto",
  );
  const [rotationScope, setRotationScope] = useState<"shared" | "per_account">(
    library?.rotationScope ?? "shared",
  );
  const [maxUsageCount, setMaxUsageCount] = useState<string>(
    library?.maxUsageCount != null ? String(library.maxUsageCount) : "",
  );
  const [fields, setFields] = useState<CustomField[]>(initialSchema);
  const [saving, setSaving] = useState(false);
  // Phase 1.x Vague 3 — token de remplissage public.
  const [publicToken, setPublicToken] = useState<string | null>(library?.publicFillToken ?? null);
  const [tokenLoading, setTokenLoading] = useState(false);

  // Re-sync local state quand la lib cible change.
  useEffect(() => {
    if (!library) return;
    setName(library.name);
    setDescription(library.description ?? "");
    setRotationMode(library.rotationMode);
    setRotationScope(library.rotationScope);
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
    setSaving(true);
    try {
      const maxUsage = maxUsageCount.trim() ? parseInt(maxUsageCount, 10) : null;
      const res = await fetch(`/api/admin/libraries/data/${library.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          rotationMode,
          rotationScope,
          maxUsageCount: maxUsage,
          fieldsSchema: fields,
        }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        toast.error(data.error ?? "Erreur lors de la sauvegarde");
        return;
      }
      toast.success("Bibliothèque mise à jour.");
      await onUpdated();
      onClose();
    } catch (err) {
      console.error("[DataLibrarySettingsDrawer] save error:", err);
      toast.error("Erreur réseau");
    } finally {
      setSaving(false);
    }
  }

  if (!library) return null;

  return (
    <Drawer open={open} onClose={onClose} side="right" size="lg">
      <Drawer.Header onClose={onClose}>
        <span className="inline-flex items-center gap-2">
          <Settings2 size={14} className="text-muted-foreground" />
          Réglages — {library.name}
        </span>
      </Drawer.Header>
      <Drawer.Body className="space-y-4">
        {/* Identité */}
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

        {/* Rotation */}
        <section className="rounded-2xl bg-card border border-border p-4  space-y-4">
          <h3 className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground">
            Rotation
          </h3>

          <FormField
            label="Mode de rotation"
            help={
              rotationMode === "auto"
                ? "Sélection automatique de la fiche la moins utilisée à chaque génération."
                : rotationMode === "override"
                  ? "Ordre fixe (V2 — non implémenté pour data, fallback sur auto pour l'instant)."
                  : "Pas de rotation auto — la fiche doit être sélectionnée manuellement."
            }
          >
            <div className="flex gap-1.5 flex-wrap">
              {(["auto", "override", "none"] as const).map((m) => (
                <Chip
                  key={m}
                  variant={rotationMode === m ? "sky" : "default"}
                  selected={rotationMode === m}
                  onClick={() => setRotationMode(m)}
                  size="md"
                >
                  {m === "auto" ? "Auto" : m === "override" ? "Ordre fixe" : "Aucune"}
                </Chip>
              ))}
            </div>
          </FormField>

          <FormField
            label="Portée"
            help={
              rotationScope === "shared"
                ? "Pool partagé : tous les comptes consomment le même stock de fiches."
                : "Indépendant par compte : chaque compte tourne dans la bibliothèque séparément."
            }
          >
            <div className="flex gap-1.5 flex-wrap">
              {(["shared", "per_account"] as const).map((s) => (
                <Chip
                  key={s}
                  variant={rotationScope === s ? "sky" : "default"}
                  selected={rotationScope === s}
                  onClick={() => setRotationScope(s)}
                  size="md"
                >
                  {s === "shared" ? "Partagé entre comptes" : "Indépendant par compte"}
                </Chip>
              ))}
            </div>
          </FormField>

          <FormField
            label="Consommation max par fiche"
            help="Vide = infini · 1 = chaque fiche utilisée une seule fois (puis bloquée)."
          >
            <Input
              type="number"
              min={1}
              max={1}
              value={maxUsageCount}
              onChange={(v) => {
                const trimmed = v.trim();
                if (!trimmed) return setMaxUsageCount("");
                setMaxUsageCount("1");
              }}
              placeholder="Vide = infini"
            />
          </FormField>
        </section>

        {/* Champs personnalisés */}
        <section className="rounded-2xl bg-card border border-border p-4  space-y-3">
          <h3 className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground">
            Champs des fiches
          </h3>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Définis les colonnes attendues dans une fiche (ex : <code className="text-[10.5px] bg-white/60 px-1 rounded">titre</code>, <code className="text-[10.5px] bg-white/60 px-1 rounded">prix</code>, <code className="text-[10.5px] bg-white/60 px-1 rounded">surface</code>). Ces champs servent à&nbsp;:
            <br />— générer un modèle CSV propre (même sans fiche existante),
            <br />— construire le formulaire « Nouvelle fiche »,
            <br />— valider les imports.
            <br />Les colonnes <code className="text-[10.5px] bg-white/60 px-1 rounded">set_tag</code> et <code className="text-[10.5px] bg-white/60 px-1 rounded">category</code> sont ajoutées automatiquement.
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
        {/* Lien public de remplissage (Phase 1.x Vague 3) */}
        <section className="rounded-2xl bg-card border border-border p-4  space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground inline-flex items-center gap-1.5">
              <Link2 size={12} /> Lien public de remplissage
            </h3>
          </div>
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
