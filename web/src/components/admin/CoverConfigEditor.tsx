"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, AlertTriangle, ExternalLink } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type CoverPreset = {
  id: string;
  name: string;
  sortOrder: number;
  config: Record<string, unknown>;
};

type Props = {
  /** Template ID — used to check that the template has a cover config. */
  templateId: string | null;
  /** Current coverConfig value (read-only — we no longer expose toggle/preset picker). */
  value: object | null;
  /**
   * Auto-normalize pattern.coverConfig to `{ enabled: true }` when autoPack is
   * selected. The detail config lives on the template itself (1 preset par
   * défaut auto-créé dans le builder).
   */
  onChange: (config: object) => void;
};

// ─── CoverConfigEditor ────────────────────────────────────────────────────────
//
// Phase 2.6 — refonte : le pattern n'a plus à choisir un preset cover.
// Le template a une config cover unique (auto-créée dans le builder).
// Le pattern indique uniquement le MODE (autoPack), pas le détail.
//
// Ce composant se borne à vérifier que le template a bien une config cover
// activée — sinon affiche un warning + lien vers le builder.

export function CoverConfigEditor({ templateId, value, onChange }: Props) {
  const [presets, setPresets] = useState<CoverPreset[]>([]);
  const [loading, setLoading] = useState(false);

  // Normalize coverConfig to { enabled: true } when autoPack mode is selected
  // and current value is missing/falsy. Done once at mount.
  useEffect(() => {
    const current = (value ?? {}) as { enabled?: boolean };
    if (current.enabled !== true) {
      onChange({ enabled: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch presets pour vérifier le statut du template
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!templateId) {
        if (!cancelled) {
          setPresets([]);
          setLoading(false);
        }
        return;
      }
      if (!cancelled) setLoading(true);
      try {
        const res = await fetch(`/api/templates/${templateId}/cover-presets`);
        if (cancelled) return;
        const data: CoverPreset[] = res.ok ? await (res.json() as Promise<CoverPreset[]>) : [];
        setPresets(data);
      } catch {
        // Non-fatal
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [templateId]);

  // ── No template ───────────────────────────────────────────────────────────
  if (!templateId) {
    return (
      <p className="text-sm text-gray-500 italic">
        Sélectionne d&apos;abord un template dans la section Source pour configurer la cover automatique.
      </p>
    );
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return <p className="text-sm text-gray-400 italic">Vérification de la config template…</p>;
  }

  // ── Résolution : on prend le preset par défaut (sortOrder min) ───────────
  const sorted = [...presets].sort((a, b) => a.sortOrder - b.sortOrder);
  const defaultPreset = sorted[0] ?? null;
  const isEnabled =
    defaultPreset !== null &&
    (defaultPreset.config as { enabled?: boolean })?.enabled !== false;

  const frameCount =
    defaultPreset && typeof (defaultPreset.config as { frameCount?: number }).frameCount === "number"
      ? (defaultPreset.config as { frameCount: number }).frameCount
      : 36;
  const overlayCount = defaultPreset && Array.isArray((defaultPreset.config as { overlayGroupIds?: unknown[] }).overlayGroupIds)
    ? ((defaultPreset.config as { overlayGroupIds: unknown[] }).overlayGroupIds.length)
    : 0;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-3">
      {!defaultPreset ? (
        <div className="rounded-lg border border-peach-200 bg-peach-50 px-3 py-2.5 flex items-start gap-2">
          <AlertTriangle size={16} className="text-peach-700 shrink-0 mt-0.5" />
          <div className="text-xs text-peach-800 flex-1">
            <p className="font-medium mb-0.5">Cover non configurée dans ce template</p>
            <p className="text-peach-800">
              Active la cover automatique côté template (onglet « Cover auto »).
            </p>
            <Link
              href={`/templates/${templateId}/edit`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-peach-800 underline hover:text-peach-900 mt-1.5"
            >
              Ouvrir le builder
              <ExternalLink size={11} />
            </Link>
          </div>
        </div>
      ) : !isEnabled ? (
        <div className="rounded-lg border border-peach-200 bg-peach-50 px-3 py-2.5 flex items-start gap-2">
          <AlertTriangle size={16} className="text-peach-700 shrink-0 mt-0.5" />
          <div className="text-xs text-peach-800 flex-1">
            <p className="font-medium mb-0.5">Cover désactivée dans le template</p>
            <p className="text-peach-800">
              La config existe mais le toggle « Activer après chaque render » est off.
            </p>
            <Link
              href={`/templates/${templateId}/edit`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-peach-800 underline hover:text-peach-900 mt-1.5"
            >
              Activer dans le builder
              <ExternalLink size={11} />
            </Link>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-sage-200 bg-sage-50 px-3 py-2.5 flex items-start gap-2">
          <CheckCircle2 size={16} className="text-sage-700 shrink-0 mt-0.5" />
          <div className="text-xs text-sage-800 flex-1">
            <p className="font-medium mb-0.5">Cover automatique configurée</p>
            <p className="text-sage-800">
              {frameCount} frames extraites · {overlayCount} overlay{overlayCount > 1 ? "s" : ""} actif{overlayCount > 1 ? "s" : ""}
            </p>
            <Link
              href={`/templates/${templateId}/edit`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sage-800 underline hover:text-sage-900 mt-1.5"
            >
              Modifier dans le builder
              <ExternalLink size={11} />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
