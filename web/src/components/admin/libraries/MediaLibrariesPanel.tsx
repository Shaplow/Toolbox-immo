"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { Plus, Trash2, Video, Music2, ChevronRight, Search, Pencil, Check, X } from "lucide-react";
import { toast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/useConfirm";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { FormField } from "@/components/ui/FormField";
import Link from "next/link";
import { LibraryExportButton } from "./LibraryExportButton";

interface MediaLibrary {
  id: string;
  name: string;
  type: "video" | "audio";
  tags: string;
  setSequence: string;
  rotationScope?: string;
  metadataSchema?: string;
  description: string | null;
  createdAt: string;
  _count: { assets: number };
}

type MetadataField = { key: string; label: string; type: "text" | "number" | "url" | "textarea" };

type EditForm = {
  name: string;
  tags: string;
  description: string;
  rotationMode: "auto" | "override";
  setSequenceDraft: string; // one setTag per line
  rotationScope: "per_account" | "shared";
  metadataFields: MetadataField[];
};

export function MediaLibrariesPanel() {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [libraries, setLibraries] = useState<MediaLibrary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", type: "video" as "video" | "audio", tags: "", description: "" });
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({ name: "", tags: "", description: "", rotationMode: "auto", setSequenceDraft: "", rotationScope: "per_account", metadataFields: [] });
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"" | "video" | "audio">("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/admin/libraries/media");
      if (!res.ok) throw new Error(`Erreur serveur (HTTP ${res.status})`);
      const data = await res.json() as MediaLibrary[];
      setLibraries(data);
    } catch (err) {
      console.error("[MediaLibrariesPanel] load error:", err);
      setLoadError(err instanceof Error ? err.message : "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { (async () => { await load(); })(); }, [load]);

  // All unique types across libraries
  const allTypes = useMemo(() => {
    const set = new Set<string>();
    libraries.forEach((lib) => {
      try { (JSON.parse(lib.tags) as string[]).forEach((t) => set.add(t)); } catch { /* ignore */ }
    });
    return Array.from(set).sort();
  }, [libraries]);

  const [typeLabelsFilter, setTypeLabelsFilter] = useState("");

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
    setError(null);
    const tags = form.tags.split(",").map((t) => t.trim()).filter(Boolean);
    const res = await fetch("/api/admin/libraries/media", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: form.name, type: form.type, tags, description: form.description }),
    });
    if (!res.ok) {
      const d = await res.json() as { error?: string };
      setError(d.error ?? "Erreur");
      return;
    }
    setCreating(false);
    const createdName = form.name;
    setForm({ name: "", type: "video", tags: "", description: "" });
    toast.success(`Bibliothèque « ${createdName} » créée.`);
    void load();
  }

  function startEdit(lib: MediaLibrary) {
    const tags = (() => { try { return (JSON.parse(lib.tags) as string[]).join(", "); } catch { return ""; } })();
    const seq = (() => { try { return JSON.parse(lib.setSequence) as string[]; } catch { return []; } })();
    setEditForm({
      name: lib.name,
      tags,
      description: lib.description ?? "",
      rotationMode: seq.length > 0 ? "override" : "auto",
      setSequenceDraft: seq.join("\n"),
      rotationScope: lib.rotationScope === "shared" ? "shared" : "per_account",
      metadataFields: (() => { try { return JSON.parse(lib.metadataSchema ?? "[]") as MetadataField[]; } catch { return []; } })(),
    });
    setEditError(null);
    setEditingId(lib.id);
  }

  async function handleSaveEdit(id: string) {
    if (!editForm.name.trim()) { setEditError("Le nom est requis"); return; }
    const metaKeys = editForm.metadataFields.map((f) => f.key.trim());
    if (metaKeys.some((k) => !k)) { setEditError("Tous les champs de métadonnées doivent avoir une clé non vide."); return; }
    if (new Set(metaKeys).size !== metaKeys.length) { setEditError("Deux champs ont la même clé. Corrigez-la avant de sauvegarder."); return; }
    setEditSaving(true);
    setEditError(null);
    const tags = editForm.tags.split(",").map((t) => t.trim()).filter(Boolean);
    const setSequence = editForm.rotationMode === "override"
      ? editForm.setSequenceDraft.split("\n").map((s) => s.trim()).filter(Boolean)
      : [];
    const res = await fetch(`/api/admin/libraries/media/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editForm.name.trim(),
        tags,
        description: editForm.description.trim() || null,
        setSequence,
        rotationScope: editForm.rotationScope,
        metadataSchema: editForm.metadataFields,
      }),
    });
    setEditSaving(false);
    if (!res.ok) {
      const d = await res.json() as { error?: string };
      setEditError(d.error ?? "Erreur lors de la sauvegarde");
      return;
    }
    setEditingId(null);
    void load();
  }

  async function handleDelete(id: string, name: string) {
    const ok = await confirm({
      title: `Supprimer la bibliothèque « ${name} » ?`,
      description: "Tous les assets associés seront également supprimés. Cette action est irréversible.",
      confirmLabel: "Supprimer",
      variant: "danger",
    });
    if (!ok) return;
    const res = await fetch(`/api/admin/libraries/media/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const d = await res.json() as { error?: string };
      toast.error(d.error ?? "Erreur lors de la suppression");
      return;
    }
    void load();
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Bibliothèques médias</h2>
          <p className="text-xs text-gray-500 mt-0.5">{libraries.length} bibliothèque{libraries.length !== 1 ? "s" : ""}</p>
        </div>
        <Button onClick={() => setCreating(true)} icon={Plus} size="sm">
          Nouvelle bibliothèque
        </Button>
      </div>

      {/* F2.1 — Create form en modal canonique (au lieu d'inline en haut de page) */}
      {creating && (
        <>
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
            onClick={() => setCreating(false)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-50 flex items-center justify-center px-4 pointer-events-none"
          >
            <form
              onSubmit={(e) => { void handleCreate(e); }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl pointer-events-auto p-6"
            >
              <h2 className="text-base font-semibold text-gray-900 mb-4">Nouvelle bibliothèque</h2>
              <div className="grid grid-cols-2 gap-4 mb-4">
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
                      <button
                        key={t}
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, type: t }))}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border text-sm transition-colors ${
                          form.type === t
                            ? "bg-indigo-600 text-white border-indigo-600"
                            : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300"
                        }`}
                      >
                        {t === "video" ? <Video size={14} /> : <Music2 size={14} />}
                        {t === "video" ? "Vidéo" : "Audio"}
                      </button>
                    ))}
                  </div>
                </FormField>
                <FormField label="Tags (séparés par virgule)">
                  <Input
                    value={form.tags}
                    onChange={(v) => setForm((f) => ({ ...f, tags: v }))}
                    placeholder="RPI, RTIPS, RPOD"
                  />
                </FormField>
                <FormField label="Description (optionnel)">
                  <Input
                    value={form.description}
                    onChange={(v) => setForm((f) => ({ ...f, description: v }))}
                  />
                </FormField>
              </div>
              {error && <p className="text-red-600 text-xs mb-3">{error}</p>}
              <div className="flex gap-2 justify-end">
                <Button type="button" variant="secondary" onClick={() => setCreating(false)}>
                  Annuler
                </Button>
                <Button type="submit">Créer</Button>
              </div>
            </form>
          </div>
        </>
      )}

      {/* Error */}
      {loadError && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 mb-4">
          <p className="font-medium">Impossible de charger les bibliothèques</p>
          <p className="font-mono text-xs mt-1">{loadError}</p>
          <button onClick={() => { void load(); }} className="text-xs underline mt-2">Réessayer</button>
        </div>
      )}

      {/* Filters */}
      {!loading && libraries.length > 0 && (
        <div className="space-y-3 mb-5">
          {/* Search + type toggle */}
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 z-10" />
              <Input
                value={search}
                onChange={setSearch}
                placeholder="Rechercher une bibliothèque…"
                className="pl-8"
              />
            </div>
            <div className="flex gap-1">
              {([["", "Tout"], ["video", "Vidéo"], ["audio", "Audio"]] as const).map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => setTypeFilter(val as "" | "video" | "audio")}
                  className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                    typeFilter === val
                      ? "bg-indigo-600 text-white border-indigo-600"
                      : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {/* Type pills */}
          {allTypes.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-gray-400">Types&nbsp;:</span>
              {allTypes.map((t) => (
                <button
                  key={t}
                  onClick={() => setTypeLabelsFilter(typeLabelsFilter === t ? "" : t)}
                  className={`px-2.5 py-0.5 rounded-full text-xs border transition-colors ${
                    typeLabelsFilter === t
                      ? "bg-indigo-600 text-white border-indigo-600"
                      : "bg-gray-50 text-gray-600 border-gray-200 hover:border-indigo-300"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Loading */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : libraries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-sm font-medium text-gray-500">Aucune bibliothèque média</p>
          <p className="text-xs text-gray-400 mt-1">Créez-en une pour commencer.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((lib) => {
            const tags = (() => { try { return JSON.parse(lib.tags) as string[]; } catch { return []; } })();
            return (
              <div
                key={lib.id}
                className="relative group flex flex-col bg-white border border-gray-200 rounded-2xl overflow-hidden hover:border-indigo-300 hover:shadow-md transition-all"
              >
                {/* Visual header */}
                <div className={`h-24 flex items-center justify-center ${
                  lib.type === "video" ? "bg-gradient-to-br from-indigo-50 to-purple-50" : "bg-gradient-to-br from-emerald-50 to-teal-50"
                }`}>
                  {lib.type === "video"
                    ? <Video size={36} className="text-indigo-300" />
                    : <Music2 size={36} className="text-emerald-300" />}
                </div>

                {/* Content */}
                <div className="flex-1 p-4">
                  {editingId === lib.id ? (
                    /* ── Edit form ── */
                    <div className="space-y-3" onClick={(e) => e.stopPropagation()}>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Nom *</label>
                        <input
                          autoFocus
                          value={editForm.name}
                          onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                          className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Types (séparés par virgule)</label>
                        <input
                          value={editForm.tags}
                          onChange={(e) => setEditForm((f) => ({ ...f, tags: e.target.value }))}
                          placeholder="RPI, RTIPS, RPOD"
                          className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
                        <input
                          value={editForm.description}
                          onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                          className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                        />
                      </div>

                      {/* ── Rotation scope ── */}
                      <div className="border border-gray-200 rounded-lg p-3 space-y-2 bg-gray-50">
                        <p className="text-xs font-medium text-gray-600">Portée de la rotation</p>
                        <div className="flex gap-2">
                          {(["per_account", "shared"] as const).map((scope) => (
                            <button
                              key={scope}
                              type="button"
                              onClick={() => setEditForm((f) => ({ ...f, rotationScope: scope }))}
                              className={`flex-1 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                                editForm.rotationScope === scope
                                  ? "bg-indigo-600 text-white border-indigo-600"
                                  : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300"
                              }`}
                            >
                              {scope === "per_account" ? "1 contenu / compte" : "Partagé entre comptes"}
                            </button>
                          ))}
                        </div>
                        <p className="text-[10px] text-gray-400 leading-relaxed">
                          {editForm.rotationScope === "per_account"
                            ? "Chaque négociateur avance dans la bibliothèque indépendamment des autres. Recommandé pour des contenus personnalisés par compte."
                            : "Tous les comptes voient le même contenu à chaque génération. Le curseur de rotation est partagé."}
                        </p>
                      </div>

                      {/* ── Rotation mode ── */}
                      <div className="border border-gray-200 rounded-lg p-3 space-y-2 bg-gray-50">
                        <p className="text-xs font-medium text-gray-600">Mode de rotation</p>
                        <div className="flex gap-2">
                          {(["auto", "override"] as const).map((mode) => (
                            <button
                              key={mode}
                              type="button"
                              onClick={() => setEditForm((f) => ({ ...f, rotationMode: mode }))}
                              className={`flex-1 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                                editForm.rotationMode === mode
                                  ? "bg-indigo-600 text-white border-indigo-600"
                                  : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300"
                              }`}
                            >
                              {mode === "auto" ? "Automatique" : "Ordre fixe"}
                            </button>
                          ))}
                        </div>
                        <p className="text-[10px] text-gray-400 leading-relaxed">
                          {editForm.rotationMode === "auto"
                            ? "Toolbox alterne les sets automatiquement selon le compte, en évitant de répéter deux sets de la même catégorie."
                            : "Vous définissez l'ordre exact de passage des sets. Chaque compte suit cet ordre indépendamment."}
                        </p>
                        {editForm.rotationMode === "override" && (
                          <div>
                            <label className="block text-[10px] font-medium text-gray-500 mb-1">
                              Ordre des sets — un setTag par ligne
                            </label>
                            <textarea
                              value={editForm.setSequenceDraft}
                              onChange={(e) => setEditForm((f) => ({ ...f, setSequenceDraft: e.target.value }))}
                              rows={4}
                              placeholder={"set1\nset2\nset3"}
                              className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs font-mono bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none"
                            />
                            <p className="text-[10px] text-gray-400 mt-0.5">
                              Les setTags doivent correspondre aux valeurs définies sur vos assets.
                            </p>
                          </div>
                        )}
                      </div>

                      {editError && <p className="text-xs text-red-600">{editError}</p>}

                      {/* ── Metadata schema ── */}
                      <div className="border border-gray-200 rounded-lg p-3 space-y-2 bg-gray-50">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-medium text-gray-600">Champs de métadonnées</p>
                          <button
                            type="button"
                            onClick={() => {
                              let n = editForm.metadataFields.length + 1;
                              while (editForm.metadataFields.some((mf) => mf.key === `champ${n}`)) n++;
                              setEditForm((f) => ({ ...f, metadataFields: [...f.metadataFields, { key: `champ${n}`, label: "", type: "text" }] }));
                            }}
                            className="flex items-center gap-1 text-[10px] text-indigo-600 hover:text-indigo-700"
                          >
                            <Plus size={11} /> Ajouter un champ
                          </button>
                        </div>
                        <p className="text-[10px] text-gray-400 leading-relaxed">
                          Définissez les champs à relier à chaque asset (ex : prix, surface). Liez-les à des variables de formulaire dans le builder via « Source automatique (asset) ».
                        </p>
                        {editForm.metadataFields.length === 0 && (
                          <p className="text-[10px] text-gray-300 italic">Aucun champ défini.</p>
                        )}
                        {editForm.metadataFields.map((field, idx) => (
                          <div key={idx} className="space-y-0.5">
                            <div className="flex items-center gap-1.5">
                              <input
                                value={field.label}
                                onChange={(e) => {
                                  const label = e.target.value;
                                  const toKey = (lbl: string) =>
                                    lbl.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
                                  let key: string;
                                  if (/^champ\d+$/.test(field.key)) {
                                    // Placeholder — auto-generate from label (accent-normalized)
                                    key = label.trim() ? (toKey(label) || field.key) : field.key;
                                  } else if (!label.trim()) {
                                    // Frozen key but label cleared → reset to a fresh placeholder
                                    let n = editForm.metadataFields.length + 1;
                                    while (editForm.metadataFields.some((mf, i2) => i2 !== idx && mf.key === `champ${n}`)) n++;
                                    key = `champ${n}`;
                                  } else {
                                    // Frozen key, label non-empty — keep key unchanged
                                    key = field.key;
                                  }
                                  setEditForm((f) => ({ ...f, metadataFields: f.metadataFields.map((mf, i) => i === idx ? { ...mf, label, key } : mf) }));
                                }}
                                placeholder="Libellé (ex: Prix de vente)"
                                className="flex-1 min-w-0 border border-gray-200 rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-indigo-300"
                              />
                              <select
                                value={field.type}
                                onChange={(e) => setEditForm((f) => ({ ...f, metadataFields: f.metadataFields.map((mf, i) => i === idx ? { ...mf, type: e.target.value as MetadataField["type"] } : mf) }))}
                                className="w-[110px] shrink-0 border border-gray-200 rounded px-1.5 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-indigo-300"
                              >
                                <option value="text">Texte</option>
                                <option value="number">Nombre</option>
                                <option value="url">URL</option>
                                <option value="textarea">Textarea</option>
                              </select>
                              <button
                                type="button"
                                onClick={() => setEditForm((f) => ({ ...f, metadataFields: f.metadataFields.filter((_, i) => i !== idx) }))}
                                className="text-gray-300 hover:text-red-400 transition-colors p-0.5"
                              >
                                <X size={12} />
                              </button>
                            </div>
                            <div className="flex items-center gap-1 pl-0.5">
                              <span className="text-[9px] font-mono text-gray-400 shrink-0">clé :</span>
                              <input
                                value={field.key}
                                onChange={(e) => {
                                  const rawKey = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "");
                                  setEditForm((f) => ({ ...f, metadataFields: f.metadataFields.map((mf, i) => i === idx ? { ...mf, key: rawKey } : mf) }));
                                }}
                                className={`flex-1 min-w-0 text-[9px] font-mono rounded px-1 py-0.5 border focus:outline-none focus:ring-1 focus:ring-indigo-200 ${
                                  editForm.metadataFields.filter((mf) => mf.key && mf.key === field.key).length > 1
                                    ? "border-red-300 bg-red-50 text-red-600"
                                    : "border-gray-200 bg-white text-gray-600"
                                }`}
                                placeholder={`champ${idx + 1}`}
                                spellCheck={false}
                              />
                              {editForm.metadataFields.filter((mf) => mf.key && mf.key === field.key).length > 1 && (
                                <span className="text-[9px] text-red-500 shrink-0">doublon !</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={() => { void handleSaveEdit(lib.id); }}
                          disabled={editSaving}
                          className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white text-xs rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                        >
                          <Check size={12} /> Enregistrer
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="flex items-center gap-1 px-3 py-1.5 border border-gray-200 text-xs rounded-lg hover:bg-gray-50"
                        >
                          <X size={12} /> Annuler
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* ── Display ── */
                    <>
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold text-gray-900 leading-snug">{lib.name}</p>
                        <span className={`shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded border ${
                          lib.type === "video"
                            ? "text-indigo-600 bg-indigo-50 border-indigo-200"
                            : "text-emerald-600 bg-emerald-50 border-emerald-200"
                        }`}>
                          {lib.type === "video" ? "Vidéo" : "Audio"}
                        </span>
                      </div>

                      {lib.description && (
                        <p className="text-xs text-gray-500 mt-1 line-clamp-2">{lib.description}</p>
                      )}

                      {tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {tags.map((tag) => (
                            <span key={tag} className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">{tag}</span>
                          ))}
                        </div>
                      )}

                      {(() => {
                        try {
                          const seq = JSON.parse(lib.setSequence) as string[];
                          if (seq.length > 0) return (
                            <p className="text-[10px] text-pink-500 mt-2">🔄 {seq.join(" → ")}</p>
                          );
                        } catch { /* ignore */ }
                        return (
                          <p className="text-[10px] text-emerald-600 mt-2 flex items-center gap-1">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                            Rotation auto
                          </p>
                        );
                      })()}

                      <div className="flex items-center justify-between mt-3">
                        <p className="text-xs text-gray-400">
                          {lib._count.assets} fichier{lib._count.assets !== 1 ? "s" : ""}
                        </p>
                        {lib.rotationScope === "shared" ? (
                          <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">Partagé</span>
                        ) : (
                          <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">Par compte</span>
                        )}
                      </div>
                    </>
                  )}
                </div>

                {/* Footer actions */}
                {editingId !== lib.id && (
                <div className="flex items-center border-t border-gray-100">
                  <Link
                    href={`/admin/libraries/media/${lib.id}`}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs text-indigo-600 font-medium hover:bg-indigo-50 transition-colors"
                  >
                    Voir les fichiers <ChevronRight size={13} />
                  </Link>
                  <div className="w-px h-5 bg-gray-100" />
                  <button
                    onClick={() => startEdit(lib)}
                    className="px-3.5 py-2.5 text-gray-300 hover:text-indigo-500 transition-colors"
                    title="Modifier"
                  >
                    <Pencil size={14} />
                  </button>
                  <div className="w-px h-5 bg-gray-100" />
                  <LibraryExportButton libraryId={lib.id} libraryName={lib.name} libraryType="media" />
                  <div className="w-px h-5 bg-gray-100" />
                  <button
                    onClick={() => { void handleDelete(lib.id, lib.name); }}
                    className="px-3.5 py-2.5 text-gray-300 hover:text-red-500 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="col-span-full flex flex-col items-center justify-center py-10 text-center text-gray-400">
              <p className="text-sm font-medium">Aucun résultat</p>
              <p className="text-xs mt-1">Modifiez les filtres pour voir plus de bibliothèques.</p>
            </div>
          )}
        </div>
      )}
      {confirmDialog}
    </div>
  );
}
