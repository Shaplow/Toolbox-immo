"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlignLeft, Film, Pencil, Plus, Scissors, X } from "lucide-react";
import { CaptionPresetActions } from "@/components/captions/CaptionPresetActions";
import { ImportCaptionPresetButton } from "@/components/captions/ImportCaptionPresetButton";
import { DEFAULT_CAPTION_CONFIG } from "@/lib/captionPresetConfig";
import { ToolPageHeader } from "@/components/layout/ToolPageHeader";

type Preset = {
  id: string;
  name: string;
  createdAt: string;
};

export function CaptionsGallery({ isAdmin }: { isAdmin: boolean }) {
  const router = useRouter();
  const [presets, setPresets] = useState<Preset[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createError, setCreateError] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [transcriptionPendingId, setTranscriptionPendingId] = useState<string | null>(null);

  useEffect(() => {
    const id = sessionStorage.getItem("transcription_pending_id");
    if (id) setTranscriptionPendingId(id);
  }, []);

  const dismissTranscription = useCallback(() => {
    sessionStorage.removeItem("transcription_pending_id");
    setTranscriptionPendingId(null);
  }, []);

  const handleGenerateClick = useCallback((presetId: string) => {
    if (transcriptionPendingId) {
      sessionStorage.removeItem("transcription_pending_id");
      setTranscriptionPendingId(null);
      router.push(`/tools/captions/${presetId}/generate?transcriptionId=${transcriptionPendingId}`);
    } else {
      router.push(`/tools/captions/${presetId}/generate`);
    }
  }, [transcriptionPendingId, router]);

  const fetchPresets = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/caption-presets");
    if (res.ok) setPresets(await res.json() as Preset[]);
    setLoading(false);
  }, []);

  useEffect(() => { void fetchPresets(); }, [fetchPresets]);

  async function handleCreatePreset() {
    const name = createName.trim();
    if (!name) {
      setCreateError("Le nom du preset est requis.");
      return;
    }

    const duplicate = presets.some((preset) => preset.name.trim().toLowerCase() === name.toLowerCase());
    if (duplicate) {
      setCreateError("Un preset avec ce nom existe déjà.");
      return;
    }

    setCreating(true);
    setCreateError("");

    try {
      const res = await fetch("/api/caption-presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, config: DEFAULT_CAPTION_CONFIG }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null) as { error?: string } | null;
        setCreateError(data?.error ?? "Impossible de créer le preset.");
        return;
      }

      const created = await res.json() as { id: string };
      setShowCreateForm(false);
      setCreateName("");
      router.push(`/tools/captions/${created.id}/edit`);
    } catch {
      setCreateError("Impossible de créer le preset.");
    } finally {
      setCreating(false);
    }
  }

  async function handleRename(id: string) {
    if (!editName.trim()) return;
    setSavingId(id);
    await fetch(`/api/caption-presets/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName.trim() }),
    });
    setSavingId(null);
    setEditingId(null);
    await fetchPresets();
  }

  if (loading) {
    return (
      <div className="p-8">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gray-200 rounded-xl animate-pulse" />
            <div>
              <div className="h-6 w-32 bg-gray-200 rounded-lg animate-pulse" />
              <div className="h-4 w-16 bg-gray-100 rounded mt-1.5 animate-pulse" />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white border border-gray-100 rounded-xl overflow-hidden">
              <div className="p-4 space-y-2">
                <div className="h-5 w-3/4 bg-gray-200 rounded animate-pulse" />
                <div className="h-4 w-16 bg-gray-100 rounded animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <ToolPageHeader
          icon={AlignLeft}
          iconColor="violet"
          title="Captions"
          subtitle={`${presets.length} preset${presets.length !== 1 ? "s" : ""}`}
          actions={isAdmin ? (
            <>
              <ImportCaptionPresetButton onImported={() => fetchPresets()} />
              <button
                type="button"
                onClick={() => {
                  setShowCreateForm((current) => !current);
                  setCreateError("");
                }}
                className="flex items-center gap-1.5 text-sm bg-violet-600 text-white px-4 py-2 rounded-lg hover:bg-violet-700 transition-colors"
              >
                <Plus size={14} />
                {showCreateForm ? "Fermer" : "Créer un preset"}
              </button>
            </>
          ) : undefined}
        />

      {isAdmin && showCreateForm && (
        <form
          className="mb-6 rounded-2xl border border-violet-200 bg-violet-50 px-5 py-4"
          onSubmit={(event) => {
            event.preventDefault();
            void handleCreatePreset();
          }}
        >
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <label className="flex-1 min-w-0">
              <span className="block text-xs font-semibold uppercase tracking-wide text-violet-700 mb-2">
                Nom du preset
              </span>
              <input
                autoFocus
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
                placeholder="Ex. Premium doré"
                className="w-full rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-400"
              />
              <span className="block text-xs text-violet-700 mt-2">
                Le preset est créé puis ouvert directement dans le builder pour édition.
              </span>
            </label>
            <div className="flex gap-2 shrink-0">
              <button
                type="submit"
                disabled={creating}
                className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-60 transition-colors"
              >
                {creating ? "Création…" : "Créer et éditer"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowCreateForm(false);
                  setCreateName("");
                  setCreateError("");
                }}
                className="rounded-lg border border-violet-200 bg-white px-4 py-2 text-sm font-medium text-violet-700 hover:bg-violet-100 transition-colors"
              >
                Annuler
              </button>
            </div>
          </div>
          {createError && (
            <p className="mt-3 text-sm text-red-600">{createError}</p>
          )}
        </form>
      )}

      {/* Transcription pending banner */}
      {transcriptionPendingId && (
        <div className="mb-6 flex items-center gap-3 bg-teal-50 border border-teal-200 rounded-xl px-5 py-4">
          <Scissors size={18} className="text-teal-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-teal-800">Transcription prête</p>
            <p className="text-xs text-teal-600 mt-0.5">Choisissez un preset ci-dessous pour découper et générer vos captions</p>
          </div>
          <button
            type="button"
            onClick={dismissTranscription}
            className="shrink-0 text-teal-400 hover:text-teal-600 transition-colors"
            title="Ignorer"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {presets.length === 0 ? (
        <div className="text-center py-24 text-gray-400">
          <Film size={40} className="mx-auto mb-4 opacity-30" />
          <p className="font-medium">Aucun preset disponible</p>
          <p className="text-sm mt-1">
            {isAdmin ? "Creez ou importez votre premier preset pour ouvrir directement le builder." : "Contactez votre administrateur"}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {presets.map((preset) => (
            <div
              key={preset.id}
              className="bg-white border border-gray-100 rounded-xl transition-colors hover:border-gray-200 group"
            >
              {/* Info */}
              <div className="p-4">
                {editingId === preset.id ? (
                  <form
                    className="flex items-center gap-1.5"
                    onSubmit={(e) => { e.preventDefault(); void handleRename(preset.id); }}
                  >
                    <input
                      autoFocus
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="flex-1 border border-gray-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 min-w-0"
                    />
                    <button
                      type="submit"
                      disabled={savingId === preset.id}
                      className="text-xs px-2 py-1 bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-60 shrink-0"
                    >
                      {savingId === preset.id ? "…" : "OK"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 shrink-0"
                    >
                      ✕
                    </button>
                  </form>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <h3 className="font-medium text-gray-900 truncate flex-1 text-sm">{preset.name}</h3>
                    {isAdmin && (
                      <button
                        onClick={() => { setEditingId(preset.id); setEditName(preset.name); }}
                        className="shrink-0 text-gray-300 hover:text-gray-600 transition-colors opacity-0 group-hover:opacity-100"
                        title="Renommer"
                      >
                        <Pencil size={12} />
                      </button>
                    )}
                  </div>
                )}
                <p className="text-xs text-gray-400 mt-1.5">
                  {new Date(preset.createdAt).toLocaleDateString("fr-FR")}
                </p>
              </div>

              {/* Actions */}
              <div className="px-4 pb-4">
                <div className="flex gap-2">
                  {isAdmin && (
                    <Link
                      href={`/tools/captions/${preset.id}/edit`}
                      className="flex-1 text-center text-xs bg-gray-900 text-white py-1.5 rounded-lg hover:bg-gray-700 transition-colors"
                    >
                      Éditer
                    </Link>
                  )}
                  <button
                    onClick={() => handleGenerateClick(preset.id)}
                    className={`flex-1 text-center text-xs py-1.5 rounded-lg transition-colors ${
                      transcriptionPendingId
                        ? "bg-teal-600 hover:bg-teal-700 text-white"
                        : "bg-violet-600 hover:bg-violet-700 text-white"
                    }`}
                  >
                    {transcriptionPendingId ? "Utiliser" : "Générer"}
                  </button>
                  {isAdmin && (
                    <CaptionPresetActions
                      id={preset.id}
                      onChanged={() => fetchPresets()}
                    />
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
