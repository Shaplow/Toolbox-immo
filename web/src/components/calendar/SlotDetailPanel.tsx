"use client";

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import { X, ExternalLink, Trash2, Check, Clapperboard } from "lucide-react";
import { STATUS_LABELS, type SlotStatus, type PublicationSlot } from "@/types/calendar";
import { STATUS_TRANSITIONS } from "@/lib/publications/transitions";
import { FlexFieldsEditor } from "./FlexFieldsEditor";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

/**
 * Mode d'affichage du panneau de détail.
 *
 * - "admin"   : comportement complet — tous les champs sont éditables,
 *               bouton Supprimer visible, bouton Générer visible.
 *               Default pour rester rétrocompatible avec les call sites existants.
 * - "monteur" : champs restreints — seuls `status` et `notes` sont éditables,
 *               cohérent avec ALLOWED_PATCH_FIELDS_BY_ROLE["MONTEUR"] côté serveur.
 * - "cm"      : identique à "monteur" côté UI.
 */
export type SlotDetailPanelMode = "admin" | "monteur" | "cm";

interface SlotDetailPanelProps {
  slot: PublicationSlot;
  onUpdated: (slot: PublicationSlot) => void;
  onDeleted: (id: string) => void;
  onClose: () => void;
  /**
   * Contrôle les actions et champs éditables selon le rôle de l'utilisateur.
   * Default : "admin" — aucun changement de comportement pour les call sites existants.
   */
  mode?: SlotDetailPanelMode;
}

const STATUSES = Object.keys(STATUS_LABELS) as SlotStatus[];

const READ_ONLY_INPUT_CLS =
  "w-full border border-gray-100 rounded-lg px-3 py-2 text-sm text-gray-600 bg-gray-50 cursor-default select-none";

export function SlotDetailPanel({ slot, onUpdated, onDeleted, onClose, mode = "admin" }: SlotDetailPanelProps) {
  /** true pour MONTEUR et CM — pilote toutes les restrictions d'affichage */
  const isRestricted = mode !== "admin";

  // ESC pour fermer le panel (pas d'overlay cliquable depuis R10 — il faut
  // garder une voie de sortie clavier en plus du bouton X).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const [form, setForm] = useState({
    title: slot.title ?? "",
    caption: slot.caption ?? "",
    notes: slot.notes ?? "",
    status: slot.status,
    fieldSchema: slot.fieldSchema,
    fields: slot.fields,
    // W2 + Cohérence Workflows Phase 4 — overrides per-slot. null = hérite.
    needsClientValidationOverride: slot.needsClientValidationOverride ?? null,
    allowsClientRevisionOverride: slot.allowsClientRevisionOverride ?? null,
    needsCaptionsOverride: slot.needsCaptionsOverride ?? null,
    needsDescriptionOverride: slot.needsDescriptionOverride ?? null,
    needsRushesOverride: slot.needsRushesOverride ?? null,
    needsBriefOverride: slot.needsBriefOverride ?? null,
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const set = useCallback(<K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }, []);

  // B6 — Statuts proposés au select pour MONTEUR/CM : statut courant + transitions
  // autorisées depuis ce statut (matrice STATUS_TRANSITIONS). Évite que MONTEUR/CM
  // puissent "sauter" des étapes du pipeline via l'UI. Pour ADMIN, voir STATUSES global.
  // Note : slot.status peut être un legacy status (TO_DO, IN_PROGRESS, etc.) qui
  // n'est pas dans STATUS_TRANSITIONS — on fallback sur tableau vide dans ce cas.
  const availableStatuses: SlotStatus[] = (() => {
    const transitions = STATUS_TRANSITIONS as Record<string, SlotStatus[]>;
    const allowed = transitions[slot.status] ?? [];
    const set = new Set<SlotStatus>([slot.status as SlotStatus, ...allowed]);
    return STATUSES.filter((s) => set.has(s));
  })();

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      /**
       * En mode restreint (monteur/cm), on n'envoie que les champs autorisés
       * par ALLOWED_PATCH_FIELDS_BY_ROLE : status et notes.
       * Le backend filtre déjà de son côté, mais ne pas envoyer les autres champs
       * évite toute ambiguïté et réduit la surface de requête.
       */
      const body = isRestricted
        ? { status: form.status, notes: form.notes || null }
        : {
            title: form.title || null,
            caption: form.caption || null,
            notes: form.notes || null,
            status: form.status,
            fields: form.fields,
            fieldSchema: form.fieldSchema,
            needsClientValidationOverride: form.needsClientValidationOverride,
            allowsClientRevisionOverride: form.allowsClientRevisionOverride,
            needsCaptionsOverride: form.needsCaptionsOverride,
            needsDescriptionOverride: form.needsDescriptionOverride,
            needsRushesOverride: form.needsRushesOverride,
            needsBriefOverride: form.needsBriefOverride,
          };

      const res = await fetch(`/api/calendar/slots/${slot.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error ?? "Erreur lors de la sauvegarde");
      }
      const updated = await res.json() as PublicationSlot;
      onUpdated(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteConfirmed() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/calendar/slots/${slot.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Erreur lors de la suppression");
      onDeleted(slot.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
      setDeleting(false);
      setConfirmDeleteOpen(false);
    }
  }

  const scheduledDate = new Date(slot.scheduledAt);

  return (
    <>
      <ConfirmDialog
        open={confirmDeleteOpen}
        title="Supprimer ce slot ?"
        description="Cette action est irréversible. Le slot et toutes ses données associées seront supprimés."
        confirmLabel="Supprimer"
        variant="danger"
        loading={deleting}
        onConfirm={() => { void handleDeleteConfirmed(); }}
        onCancel={() => setConfirmDeleteOpen(false)}
      />

      {/* Side panel persistant — pas d'overlay bloquant, l'utilisateur peut
          continuer à scroller le calendrier en arrière-plan et cliquer un
          autre slot pour le sélectionner. ESC ou bouton X pour fermer. */}
      <div className="fixed right-0 top-0 h-full w-full max-w-lg bg-white z-40 shadow-2xl border-l border-gray-200 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">
              {scheduledDate.toLocaleDateString("fr-FR", {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}{" "}
              à{" "}
              {scheduledDate.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              @{slot.account.handle}
            </p>
            <Link
              href={`/publications/${slot.id}`}
              className="inline-flex items-center gap-1 mt-1.5 text-xs text-indigo-600 hover:text-indigo-800 hover:underline"
            >
              Ouvrir la fiche complète <ExternalLink size={11} />
            </Link>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          {/* Status row */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Statut</label>
            {/* B6 — pour les modes restreints (MONTEUR/CM), on ne montre que :
                 - le statut courant (pour pouvoir le laisser inchangé)
                 - les transitions autorisées depuis ce statut (STATUS_TRANSITIONS).
               Pour ADMIN, tous les statuts restent disponibles (bypass matrice). */}
            <select
              value={form.status}
              onChange={(e) => set("status", e.target.value as SlotStatus)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            >
              {(isRestricted ? availableStatuses : STATUSES).map((s) => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </select>
          </div>

          {/* Title — admin uniquement */}
          {!isRestricted && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Titre</label>
              <input
                type="text"
                value={form.title}
                onChange={(e) => set("title", e.target.value)}
                placeholder="Nom du bien, propriétaire…"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
            </div>
          )}

          {/* Title — monteur/cm : lecture seule, affiché uniquement si une valeur existe */}
          {isRestricted && form.title && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Titre</label>
              <p className={READ_ONLY_INPUT_CLS}>{form.title}</p>
            </div>
          )}

          {/* Caption — admin uniquement */}
          {!isRestricted && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Légende Instagram</label>
              <textarea
                value={form.caption}
                onChange={(e) => set("caption", e.target.value)}
                rows={3}
                placeholder="Texte de la publication…"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none"
              />
            </div>
          )}

          {/* Template affiché en lecture seule pour monteur/cm */}
          {isRestricted && slot.template && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Template</label>
              <p className={READ_ONLY_INPUT_CLS}>{slot.template.name}</p>
            </div>
          )}

          {/* Flex fields — admin uniquement */}
          {!isRestricted && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-2">
                Informations complémentaires
              </label>
              <FlexFieldsEditor
                schema={form.fieldSchema}
                values={form.fields}
                onChange={(schema, values) => {
                  set("fieldSchema", schema);
                  set("fields", values);
                }}
              />
            </div>
          )}

          {/* Notes — éditable pour tous les modes */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Notes internes</label>
            <textarea
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              rows={2}
              placeholder="Notes privées, instructions pour le monteur…"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none"
            />
          </div>

          {/* Overrides per-slot (ADMIN uniquement) — repliable par défaut */}
          {!isRestricted && (
            <details className="rounded-lg border border-fuchsia-100 bg-fuchsia-50/30 p-3 group">
              <summary className="cursor-pointer text-xs font-medium text-fuchsia-900 select-none flex items-center gap-1.5">
                <span>Cette publication uniquement</span>
                <span className="text-fuchsia-700/70 font-normal">
                  · overrider la config du pattern
                </span>
              </summary>
              <div className="mt-3 space-y-2.5">
                <p className="text-xs text-fuchsia-700/80">
                  Laissez sur « Hériter » pour utiliser la valeur du pattern parent.
                  Forcer Oui/Non écrase pour ce slot uniquement.
                </p>
                <OverrideSelect
                  label="Validation client requise"
                  value={form.needsClientValidationOverride}
                  inheritedValue={slot.pattern?.needsClientValidation ?? false}
                  onChange={(v) => set("needsClientValidationOverride", v)}
                />
                <OverrideSelect
                  label="Autoriser révisions client"
                  value={form.allowsClientRevisionOverride}
                  inheritedValue={slot.pattern?.allowsClientRevision ?? false}
                  onChange={(v) => set("allowsClientRevisionOverride", v)}
                  disabled={
                    (form.needsClientValidationOverride === false) ||
                    (form.needsClientValidationOverride === null &&
                      slot.pattern?.needsClientValidation === false)
                  }
                />
                <OverrideSelect
                  label="Sous-titres auto"
                  value={form.needsCaptionsOverride}
                  inheritedValue={slot.pattern?.needsCaptions ?? false}
                  onChange={(v) => set("needsCaptionsOverride", v)}
                />
                <OverrideEnumSelect
                  label="Description"
                  value={form.needsDescriptionOverride}
                  inheritedValue={slot.pattern?.needsDescription ?? "none"}
                  onChange={(v) => set("needsDescriptionOverride", v)}
                  options={[
                    { value: "none", label: "Aucune" },
                    { value: "preFilled", label: "Pré-remplie" },
                    { value: "autoGenerate", label: "Auto-générée" },
                    { value: "manualWrite", label: "Manuelle" },
                  ]}
                />
                <OverrideSelect
                  label="Rushes attendus"
                  value={form.needsRushesOverride}
                  inheritedValue={slot.pattern?.needsRushes ?? false}
                  onChange={(v) => set("needsRushesOverride", v)}
                />
                <OverrideSelect
                  label="Brief éditorial"
                  value={form.needsBriefOverride}
                  inheritedValue={slot.pattern?.needsBrief ?? false}
                  onChange={(v) => set("needsBriefOverride", v)}
                />
              </div>
            </details>
          )}

          {/* Render link */}
          {slot.render && (
            <div className="rounded-lg border border-gray-200 p-3">
              <p className="text-xs font-medium text-gray-600 mb-2">Render final</p>
              <div className="flex items-center gap-2">
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  slot.render.status === "DONE"
                    ? "bg-green-100 text-green-700"
                    : slot.render.status === "ERROR"
                    ? "bg-red-100 text-red-700"
                    : "bg-amber-100 text-amber-700"
                }`}>
                  {slot.render.status}
                </span>
                <a
                  href={slot.render.videoUrl ?? slot.render.pngUrl ?? `/renders/${slot.render.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto text-xs text-indigo-600 hover:underline flex items-center gap-1"
                >
                  Voir <ExternalLink size={11} />
                </a>
              </div>
            </div>
          )}

          {error && (
            <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-100 flex items-center gap-2">
          {/* Bouton Supprimer — admin uniquement */}
          {!isRestricted && (
            <button
              type="button"
              onClick={() => setConfirmDeleteOpen(true)}
              disabled={deleting}
              className="p-2 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors"
            >
              <Trash2 size={15} />
            </button>
          )}

          <div className="flex-1" />

          {/* Bouton Générer — admin uniquement, quand un template est lié */}
          {!isRestricted && slot.templateId && (
            <a
              href={`/generate/${slot.templateId}?accountId=${slot.accountId}&slotId=${slot.id}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-indigo-700 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors"
              title="Ouvrir le formulaire de génération pré-rempli pour ce compte"
            >
              <Clapperboard size={14} />
              Générer
            </a>
          )}

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            Fermer
          </button>
          <button
            type="button"
            onClick={() => { void handleSave(); }}
            disabled={saving}
            className="px-4 py-2 text-sm text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-60 flex items-center gap-2"
          >
            {saved ? <><Check size={14} /> Sauvegardé</> : saving ? "Sauvegarde…" : "Sauvegarder"}
          </button>
        </div>
      </div>
    </>
  );
}

// ─── OverrideSelect (W2 — validation client) ─────────────────────────────────

/**
 * Select à 3 valeurs pour les overrides nullable :
 * - "inherit" (value=null) : hérite du pattern, affiche la valeur héritée
 * - "true"    : override = true (forcer activé)
 * - "false"   : override = false (forcer désactivé)
 */
function OverrideSelect({
  label,
  value,
  inheritedValue,
  onChange,
  disabled,
}: {
  label: string;
  value: boolean | null;
  inheritedValue: boolean;
  onChange: (v: boolean | null) => void;
  disabled?: boolean;
}) {
  const selectValue = value === null ? "inherit" : value ? "true" : "false";
  const isOverridden = value !== null;
  return (
    <label className="block">
      <span className="text-xs text-gray-600 flex items-center gap-1">
        {label}
        {isOverridden && (
          <span className="text-[10px] font-semibold text-fuchsia-700 bg-fuchsia-100 px-1 rounded">
            ✎ override
          </span>
        )}
      </span>
      <select
        value={selectValue}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === "inherit" ? null : v === "true");
        }}
        disabled={disabled}
        className="mt-1 w-full border border-fuchsia-200 rounded px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-fuchsia-300 disabled:opacity-50 disabled:bg-gray-50"
      >
        <option value="inherit">
          Hériter du pattern ({inheritedValue ? "Oui" : "Non"})
        </option>
        <option value="true">Forcer : Oui</option>
        <option value="false">Forcer : Non</option>
      </select>
    </label>
  );
}

/**
 * Variante OverrideSelect pour les champs enum (ex: needsDescription qui a
 * 4 valeurs). Même contrat : null = hérite ; sinon écrase avec la valeur.
 */
function OverrideEnumSelect({
  label,
  value,
  inheritedValue,
  onChange,
  options,
}: {
  label: string;
  value: string | null;
  inheritedValue: string;
  onChange: (v: string | null) => void;
  options: { value: string; label: string }[];
}) {
  const isOverridden = value !== null;
  const inheritedLabel = options.find((o) => o.value === inheritedValue)?.label ?? inheritedValue;
  return (
    <label className="block">
      <span className="text-xs text-gray-600 flex items-center gap-1">
        {label}
        {isOverridden && (
          <span className="text-[10px] font-semibold text-fuchsia-700 bg-fuchsia-100 px-1 rounded">
            ✎ override
          </span>
        )}
      </span>
      <select
        value={value ?? "__inherit__"}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === "__inherit__" ? null : v);
        }}
        className="mt-1 w-full border border-fuchsia-200 rounded px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-fuchsia-300"
      >
        <option value="__inherit__">Hériter du pattern ({inheritedLabel})</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            Forcer : {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}
