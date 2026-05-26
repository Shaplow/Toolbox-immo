"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { X, ExternalLink, Trash2, Check, Clapperboard } from "lucide-react";
import { STATUS_LABELS, CONTENT_TYPES, type SlotStatus, type PublicationSlot } from "@/types/calendar";
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

  const [form, setForm] = useState({
    title: slot.title ?? "",
    caption: slot.caption ?? "",
    notes: slot.notes ?? "",
    status: slot.status,
    contentType: slot.contentType,
    fieldSchema: slot.fieldSchema,
    fields: slot.fields,
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
            contentType: form.contentType,
            fields: form.fields,
            fieldSchema: form.fieldSchema,
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

      {/* Overlay */}
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full w-full max-w-lg bg-white z-50 shadow-2xl flex flex-col overflow-hidden">
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
              @{slot.account.handle} · {slot.account.offre}
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
          {/* Status + type row */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-600 mb-1">Statut</label>
              {/* status : éditable pour tous les modes */}
              <select
                value={form.status}
                onChange={(e) => set("status", e.target.value as SlotStatus)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
              {/* contentType : éditable uniquement pour admin */}
              {isRestricted ? (
                <p className={READ_ONLY_INPUT_CLS}>{form.contentType}</p>
              ) : (
                <select
                  value={form.contentType}
                  onChange={(e) => set("contentType", e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                >
                  {CONTENT_TYPES.map((ct) => (
                    <option key={ct} value={ct}>{ct}</option>
                  ))}
                </select>
              )}
            </div>
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
