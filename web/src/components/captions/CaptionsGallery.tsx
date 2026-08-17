"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AlignLeft, ChevronLeft, FileText, Film, Pencil, Plus, Scissors, X } from "lucide-react";
import { CaptionPresetActions } from "@/components/captions/CaptionPresetActions";
import { ImportCaptionPresetButton } from "@/components/captions/ImportCaptionPresetButton";
import { DEFAULT_CAPTION_CONFIG } from "@/lib/captionPresetConfig";
import { isSafeRelativePath } from "@/lib/safeUrl";
import { ToolPageHeader } from "@/components/layout/ToolPageHeader";
import { toast } from "@/components/ui/Toast";

type Preset = {
  id: string;
  name: string;
  createdAt: string;
};

export function CaptionsGallery({ isAdmin }: { isAdmin: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const transcriptionPendingId = searchParams?.get("transcriptionId");

  /**
   * Paramètre `returnTo` passé depuis CaptionsSection des fiches publication.
   * V3 friction MED-1 : validation centralisée via lib/safeUrl. Avant on
   * faisait juste startsWith("/") && !startsWith("//") localement — plus
   * faible que la version isSafeRelativePath qui couvre traversées encodées,
   * espaces, caractères non-ASCII, etc.
   */
  const rawReturnTo = searchParams?.get("returnTo") ?? null;
  const returnTo = rawReturnTo && isSafeRelativePath(rawReturnTo) ? rawReturnTo : null;

  /** Label contextuel pour le breadcrumb retour. */
  function getReturnLabel(path: string): string {
    if (path.startsWith("/publications/")) return "Retour à la publication";
    if (path.startsWith("/listings")) return "Retour aux annonces";
    return "Retour";
  }
  const [presets, setPresets] = useState<Preset[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createError, setCreateError] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

  const dismissTranscription = useCallback(() => {
    router.replace("/captions");
  }, [router]);

  const slotId = searchParams?.get("slotId") ?? null;

  // Contexte de la publication source (si on arrive depuis la fiche pub).
  const [slotContext, setSlotContext] = useState<{
    id: string;
    title: string | null;
    handle: string;
  } | null>(null);

  useEffect(() => {
    if (!slotId) {
      setSlotContext(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/calendar/slots/${slotId}`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          id: string;
          title: string | null;
          account: { handle: string };
        };
        if (!cancelled) {
          setSlotContext({ id: data.id, title: data.title, handle: data.account.handle });
        }
      } catch {
        // Silent : la galerie reste fonctionnelle sans bandeau si le fetch rate.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slotId]);

  const handleGenerateClick = useCallback((presetId: string) => {
    const extra = new URLSearchParams();
    if (transcriptionPendingId) extra.set("transcriptionId", transcriptionPendingId);
    if (slotId) extra.set("slotId", slotId);
    if (returnTo) extra.set("returnTo", returnTo);
    const query = extra.toString();
    if (query) {
      router.push(`/captions/${presetId}/generate?${query}`);
    } else {
      router.push(`/captions/${presetId}/generate`);
    }
  }, [transcriptionPendingId, slotId, returnTo, router]);

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
      toast.success(`Preset « ${name} » créé.`);
      router.push(`/admin/captions/presets/${created.id}/edit`);
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
      <div className="min-h-screen">
        <div
          className="mx-auto max-w-7xl px-6 py-8"

        >
          <div className="px-6 sm:px-8 pt-6 pb-12">
            <div className="max-w-5xl mx-auto">
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-muted rounded-xl animate-pulse" />
                  <div>
                    <div className="h-6 w-32 bg-muted rounded-lg animate-pulse" />
                    <div className="h-4 w-16 bg-muted rounded mt-1.5 animate-pulse" />
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className="bg-muted rounded-xl overflow-hidden "
                  >
                    <div className="p-4 space-y-2">
                      <div className="h-5 w-3/4 bg-muted rounded animate-pulse" />
                      <div className="h-4 w-16 bg-muted rounded animate-pulse" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div
        className="mx-auto max-w-7xl px-6 py-8"

      >
        <div className="px-6 sm:px-8 pt-6 pb-12">
          <div className="max-w-5xl mx-auto space-y-6">
      {/* Breadcrumb retour vers la fiche source (ex. /publications/<id>) */}
      {returnTo && (
        <div className="mb-4">
          <Link
            href={returnTo}
            className="inline-flex items-center gap-1.5 text-sm text-foreground hover:text-foreground hover:underline transition-colors"
          >
            <ChevronLeft size={15} />
            {getReturnLabel(returnTo)}
          </Link>
        </div>
      )}

      {/* V5.A.1 — Banner contextuel quand on vient d'une fiche (pattern aligné
          sur TranscriptionList V2.5). Sans ça, l'admin ouvrait la gallery preset
          sans savoir s'il était toujours dans le contexte d'un slot. */}
      {slotContext && (
        <div className="mb-4 rounded-xl bg-info-50 px-4 py-3 ">
          <p className="text-[10px] uppercase tracking-widest font-semibold text-info-700">
            Sous-titres pour une publication
          </p>
          <p className="mt-1 text-[13px] text-info-700">
            {slotContext.title ?? "Publication"} · @{slotContext.handle}
          </p>
          <p className="mt-0.5 text-[11px] text-info-700/80">
            Choisis un preset pour générer les sous-titres de cette publication.
          </p>
        </div>
      )}

      <ToolPageHeader
          icon={AlignLeft}
          iconTint="rose"
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
                className="flex items-center gap-1.5 text-sm bg-gray-900 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors"
              >
                <Plus size={14} />
                {showCreateForm ? "Fermer" : "Créer un preset"}
              </button>
            </>
          ) : undefined}
        />

      {/* F3.6 — Create form en modal canonique (au lieu d'inline) */}
      {isAdmin && showCreateForm && (
        <>
          <div
            className="fixed inset-0 bg-black/60 z-40"
            onClick={() => {
              setShowCreateForm(false);
              setCreateName("");
              setCreateError("");
            }}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-preset-title"
            className="fixed inset-0 z-50 flex items-center justify-center px-4 pointer-events-none"
          >
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void handleCreatePreset();
              }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md pointer-events-auto p-6"
            >
              <h2 id="create-preset-title" className="text-base font-semibold text-foreground mb-1">
                Nouveau preset
              </h2>
              <p className="text-sm text-muted-foreground mb-4">
                Le preset est créé puis ouvert directement dans le builder pour édition.
              </p>
              <label className="block">
                <span className="block text-xs font-medium text-muted-foreground mb-1">
                  Nom du preset <span className="text-red-400">*</span>
                </span>
                <input
                  autoFocus
                  value={createName}
                  onChange={(event) => setCreateName(event.target.value)}
                  placeholder="Ex. Premium doré"
                  className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-gray-500"
                />
              </label>
              {createError && (
                <p className="mt-3 text-xs text-red-600">{createError}</p>
              )}
              <div className="flex gap-2 justify-end mt-5">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateForm(false);
                    setCreateName("");
                    setCreateError("");
                  }}
                  className="rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-60 transition-colors"
                >
                  {creating ? "Création…" : "Créer et éditer"}
                </button>
              </div>
            </form>
          </div>
        </>
      )}

      {/* Slot context banner — affiché quand on arrive depuis une fiche publication */}
      {slotContext && (
        <div className="mb-6 flex items-center gap-3 bg-warning-50 border border-warning-200 rounded-xl px-5 py-4">
          <FileText size={18} className="text-warning-700 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-warning-700">
              Sélectionnez un preset pour la publication{" "}
              <span className="font-bold">
                {slotContext.title ?? `@${slotContext.handle}`}
              </span>
            </p>
            <p className="text-xs text-warning-700 mt-0.5">
              Le preset choisi sera utilisé pour générer les sous-titres de ce slot.
            </p>
          </div>
        </div>
      )}

      {/* Transcription pending banner */}
      {transcriptionPendingId && (
        <div className="mb-6 flex items-center gap-3 bg-info-50 border border-info-200 rounded-xl px-5 py-4">
          <Scissors size={18} className="text-info-700 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-info-700">Transcription prête</p>
            <p className="text-xs text-info-700 mt-0.5">Choisissez un preset ci-dessous pour découper et générer vos captions</p>
          </div>
          <button
            type="button"
            onClick={dismissTranscription}
            className="shrink-0 text-info-600 hover:text-info-700 transition-colors"
            title="Ignorer"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {presets.length === 0 ? (
        <div className="text-center py-24 text-muted-foreground">
          <Film size={40} className="mx-auto mb-4 opacity-30" />
          <p className="font-medium">Aucun preset disponible</p>
          <p className="text-sm mt-1">
            {isAdmin ? "Créez ou importez votre premier preset pour ouvrir directement le builder." : "Contactez votre administrateur"}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {presets.map((preset) => (
            <div
              key={preset.id}
              className="bg-white border border-border rounded-xl transition-colors hover:border-border group"
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
                      className="flex-1 border border-border rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-gray-500 min-w-0"
                    />
                    <button
                      type="submit"
                      disabled={savingId === preset.id}
                      className="text-xs px-2 py-1 bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-60 shrink-0"
                    >
                      {savingId === preset.id ? "…" : "Renommer"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="text-xs px-2 py-1 bg-muted text-muted-foreground rounded-lg hover:bg-gray-200 shrink-0"
                    >
                      ✕
                    </button>
                  </form>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <h3 className="font-medium text-foreground truncate flex-1 text-sm">{preset.name}</h3>
                    {isAdmin && (
                      <button
                        onClick={() => { setEditingId(preset.id); setEditName(preset.name); }}
                        className="shrink-0 text-muted-foreground/60 hover:text-muted-foreground transition-colors opacity-0 group-hover:opacity-100"
                        title="Renommer"
                      >
                        <Pencil size={12} />
                      </button>
                    )}
                  </div>
                )}
                <p className="text-xs text-muted-foreground mt-1.5">
                  {new Date(preset.createdAt).toLocaleDateString("fr-FR")}
                </p>
              </div>

              {/* Actions */}
              <div className="px-4 pb-4">
                <div className="flex gap-2">
                  {isAdmin && (
                    <Link
                      href={`/admin/captions/presets/${preset.id}/edit`}
                      className="flex-1 text-center text-xs bg-gray-900 text-white py-1.5 rounded-lg hover:bg-gray-700 transition-colors"
                    >
                      Éditer
                    </Link>
                  )}
                  <button
                    onClick={() => handleGenerateClick(preset.id)}
                    className={`flex-1 text-center text-xs py-1.5 rounded-lg transition-colors ${
                      transcriptionPendingId
                        ? "bg-gray-900 hover:bg-gray-700 text-white"
                        : "bg-gray-800 hover:bg-gray-600 text-white"
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
        </div>
      </div>
    </div>
  );
}
