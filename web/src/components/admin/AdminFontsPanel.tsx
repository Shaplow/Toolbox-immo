"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type FontAsset = {
  id: string;
  family: string;
  weight: number;
  fontStyle: string;
  url: string;
  storageKey: string | null;
  originalName: string | null;
  createdAt: string;
  updatedAt: string;
};

const CAPTION_EXTENSIONS = new Set([".ttf", ".otf"]);

function getExtension(font: Pick<FontAsset, "originalName" | "url">): string {
  const raw = (font.originalName || font.url).split("?")[0].toLowerCase();
  const dotIndex = raw.lastIndexOf(".");
  return dotIndex === -1 ? "" : raw.slice(dotIndex);
}

function isCaptionCompatible(font: Pick<FontAsset, "originalName" | "url">): boolean {
  return CAPTION_EXTENSIONS.has(getExtension(font));
}

async function readJsonSafely<T>(res: Response): Promise<T | null> {
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return null;
  return await res.json() as T;
}

export function AdminFontsPanel() {
  const [fonts, setFonts] = useState<FontAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadFonts = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true);
    setError(null);
    try {
      const fontsRes = await fetch("/api/font-assets", { cache: "no-store" });
      const data = await readJsonSafely<FontAsset[] | { error?: string }>(fontsRes);
      if (!fontsRes.ok || !data) throw new Error(data && "error" in data ? data.error || "Chargement impossible" : "Chargement impossible");
      setFonts(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chargement impossible");
      setFonts([]);
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await loadFonts();

      try {
        setSyncing(true);
        const syncRes = await fetch("/api/font-assets/sync", {
          method: "POST",
          cache: "no-store",
        });
        const syncData = await readJsonSafely<{ error?: string }>(syncRes);
        if (!syncRes.ok) {
          throw new Error(syncData?.error ?? "Synchronisation impossible");
        }
        await loadFonts({ silent: true });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Synchronisation impossible");
      } finally {
        setSyncing(false);
      }
    })();
  }, [loadFonts]);

  async function handleUpload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload/font", { method: "POST", body: formData });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Upload impossible");
      await loadFonts();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload impossible");
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(font: FontAsset) {
    setError(null);
    try {
      const res = await fetch(`/api/font-assets/${font.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Suppression impossible");
      setFonts((current) => current.filter((item) => item.id !== font.id));
      setConfirmDeleteId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Suppression impossible");
      setConfirmDeleteId(null);
    }
  }

  const stats = useMemo(() => ({
    total: fonts.length,
    captions: fonts.filter(isCaptionCompatible).length,
  }), [fonts]);

  const filteredFonts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return fonts;
    return fonts.filter((font) => {
      const haystack = `${font.family} ${font.originalName ?? ""} ${font.storageKey ?? ""}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [fonts, query]);

  return (
    <div className="space-y-6">
      <div className="rounded-[28px] border border-gray-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eef2ff_45%,#ffffff_100%)] p-6 shadow-sm">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-[11px] font-semibold tracking-[0.22em] uppercase text-indigo-500">Bibliothèque globale</p>
            <h2 className="text-2xl font-semibold text-gray-900 mt-2">Toutes les typographies de l&apos;app au même endroit</h2>
            <p className="text-sm text-gray-600 mt-2">
              Cette page centralise les polices utilisées par les templates et, pour les formats compatibles, par captions.
              Les anciennes polices détectées dans public/fonts et dans le moteur captions sont rattachées ici automatiquement.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3 min-w-36">
              <p className="text-[11px] uppercase tracking-[0.14em] text-gray-400">Total</p>
              <p className="text-2xl font-semibold text-gray-900 mt-1">{stats.total}</p>
            </div>
            <div className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3 min-w-36">
              <p className="text-[11px] uppercase tracking-[0.14em] text-gray-400">Captions</p>
              <p className="text-2xl font-semibold text-gray-900 mt-1">{stats.captions}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="flex-1">
            <label className="block text-[11px] font-semibold tracking-[0.16em] uppercase text-gray-400 mb-2">
              Rechercher
            </label>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Nom de famille, fichier, storage key..."
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
          <div className="flex flex-wrap items-end gap-3 xl:shrink-0">
            <input
              ref={fileRef}
              type="file"
              accept=".woff,.woff2,.ttf,.otf"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleUpload(file);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading || syncing}
              className="h-[42px] whitespace-nowrap px-4 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-60"
            >
              {uploading ? "Import en cours…" : "Importer une typo"}
            </button>
          </div>
        </div>
        <p className="text-xs text-gray-400 mt-4">
          Le poids (100–900) est inféré automatiquement depuis le nom du fichier (ex : <em>Oswald-Bold.ttf</em> → 700). Pour les variantes d&apos;une même famille, uploadez un fichier par poids avec le mot-clé correspondant dans le nom.
        </p>
        <p className="text-xs text-gray-400 mt-1">
          woff et woff2 restent reservés au web. Pour captions, seules les polices ttf et otf sont utilisables par le moteur Python.
        </p>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </div>

      <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-6 text-sm text-gray-400">Chargement des typographies…</div>
        ) : filteredFonts.length === 0 ? (
          <div className="p-6 text-sm text-gray-400">Aucune typographie globale pour le moment.</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredFonts.map((font) => {
              const compatible = isCaptionCompatible(font);
              return (
                <div key={font.id} className="px-5 py-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between hover:bg-gray-50/70 transition-colors">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-gray-900 truncate" style={{ fontFamily: font.family }}>
                        {font.family}
                      </p>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${compatible ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                        {compatible ? "Captions + Templates" : "Templates uniquement"}
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 uppercase tracking-wide">
                        {getExtension(font).replace(".", "") || "n/a"}
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 font-medium">
                        {font.weight}w
                      </span>
                      {font.fontStyle === "italic" && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-50 text-purple-600 italic font-medium">
                          italic
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{font.originalName ?? font.storageKey ?? font.url}</p>
                    <p className="text-[11px] text-gray-400 mt-1">Mise à jour le {new Date(font.updatedAt).toLocaleDateString("fr-FR")}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <a
                      href={font.url}
                      target="_blank"
                      rel="noreferrer"
                      className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
                    >
                      Ouvrir
                    </a>
                    {confirmDeleteId === font.id ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void handleDelete(font)}
                          className="px-3 py-1.5 text-xs rounded-lg bg-red-500 text-white hover:bg-red-600"
                        >
                          Confirmer
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50"
                        >
                          Annuler
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(font.id)}
                        className="px-3 py-1.5 text-xs rounded-lg border border-red-200 text-red-600 hover:bg-red-50"
                      >
                        Supprimer
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {syncing && !loading ? (
        <p className="text-xs text-gray-400 px-1">Synchronisation automatique des typographies en cours…</p>
      ) : null}

    </div>
  );
}