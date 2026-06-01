import Link from "next/link";
import { LayoutTemplate, ShieldAlert, ArrowRight, Wrench } from "lucide-react";
import { TOOL_LABELS, TOOL_DESCRIPTIONS, type Tool } from "@/lib/permissions";
import { TOOL_META } from "@/lib/toolMeta";

// parsePermissions inliné — évite de pull userContext.ts (qui importe
// next/headers et casse le bundle client).
function parsePermissions(raw: string | null | undefined): string[] {
  try {
    return JSON.parse(raw ?? "[]") as string[];
  } catch {
    return [];
  }
}

export interface HomeExternalClientAccess {
  templates: Array<{
    id: string;
    name: string;
    /** Cover image (PNG ou cover finale du CoverFramePack) du dernier rendu DONE de l'user. */
    previewUrl: string | null;
    /** Fallback : URL vidéo du dernier rendu DONE quand pas d'image dispo. */
    previewVideoUrl: string | null;
  }>;
}

interface HomeExternalClientProps {
  /** Valeur brute de User.permissions (JSON array en base). */
  permissions: string;
  /** Templates assignés à cet utilisateur externe. */
  access: HomeExternalClientAccess;
}

/**
 * Page d'accueil pour le rôle EXTERNAL_GENERATOR (client externe).
 *
 * Pattern gateway — distinct des worklists pipeline. Affiche :
 *  1. CTA "Mes générations" → /listings (historique de leurs renders)
 *  2. Liste des templates accessibles (click → /generate/[id])
 *  3. Liste des outils granulaires éventuellement attribués
 *
 * Out of scope : presets sous-titres, pipeline éditoriale.
 */
export function HomeExternalClient({ permissions, access }: HomeExternalClientProps) {
  const userPerms = parsePermissions(permissions) as Tool[];
  const knownTools = userPerms.filter((p): p is Tool => p in TOOL_LABELS);
  const otherTools = knownTools.filter((t) => t !== "templates");
  const hasOtherTools = otherTools.length > 0;
  const hasTemplates = access.templates.length > 0;
  const hasAnyAccess = hasOtherTools || hasTemplates;

  // ── Empty state — aucun accès attribué ────────────────────────────────
  if (!hasAnyAccess) {
    return (
      <div className="min-h-screen">
        <div
          className="my-11 ml-[60px] mr-[100px] rounded-3xl min-h-[calc(100vh-5.5rem)] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06),0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.10)] flex items-center justify-center"
          style={{
            background: "var(--gradient-page-shell)",
          }}
        >
          <div className="max-w-md mx-auto px-6 flex flex-col items-center text-center gap-5">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-peach-50/80 backdrop-blur-[8px] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_0_1px_rgba(245,158,107,0.22)]">
              <ShieldAlert size={20} className="text-peach-700" />
            </span>
            <div>
              <h1 className="text-[20px] font-semibold text-gray-950 mb-2">
                Aucun accès actif
              </h1>
              <p className="text-[13px] text-gray-500 leading-relaxed">
                Aucun template ne vous a été attribué pour le moment. Contactez votre
                administrateur pour activer vos accès.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div
        className="my-11 ml-[60px] mr-[100px] rounded-3xl min-h-[calc(100vh-5.5rem)] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06),0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.10)]"
        style={{
          background: "var(--gradient-page-shell)",
        }}
      >
        {/* Header Control Center */}
        <div className="rounded-t-3xl overflow-hidden">
          <div className="max-w-5xl mx-auto px-6 sm:px-8 pt-6 pb-2">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500">
                  Mon espace
                </p>
                <h1 className="mt-2 text-[36px] sm:text-[44px] font-semibold tracking-tight text-gray-950 leading-[1.05]">
                  Bienvenue
                </h1>
                <p className="mt-2 text-[13px] text-gray-500">
                  Vos templates et générations en un coup d&apos;œil.
                </p>
              </div>

              {/* CTA Mes générations en pill glass */}
              <Link
                href="/listings"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/55 backdrop-blur-[12px] text-gray-700 hover:text-gray-950 text-[12px] font-medium shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.14),0_2px_6px_rgba(15,23,42,0.06)] transition-all"
              >
                Mes générations
                <ArrowRight size={13} />
              </Link>
            </div>
          </div>
        </div>

        <div className="pt-6 md:pt-8 pb-12 px-4 sm:px-6 md:px-8">
          <div className="max-w-5xl mx-auto space-y-6">
            {hasTemplates && (
              <section className="rounded-2xl bg-gradient-to-b from-white/75 to-white/55 backdrop-blur-[8px] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08),0_2px_8px_-2px_rgba(15,23,42,0.06)]">
                <div className="flex items-center justify-between gap-2 mb-4">
                  <div>
                    <p className="text-[13px] font-semibold tracking-tight text-gray-950">
                      Templates accessibles
                    </p>
                    <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500 mt-0.5">
                      {access.templates.length} disponible
                      {access.templates.length > 1 ? "s" : ""}
                    </p>
                  </div>
                  <LayoutTemplate size={16} className="text-gray-400" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {access.templates.map((t) => {
                    const hasPreview = !!t.previewUrl || !!t.previewVideoUrl;
                    return (
                      <Link
                        key={t.id}
                        href={`/generate/${t.id}`}
                        className="group flex items-stretch gap-3 p-2 pr-4 rounded-xl bg-white shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08),0_2px_4px_rgba(15,23,42,0.04),0_8px_20px_-12px_rgba(15,23,42,0.14)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.14),0_4px_8px_rgba(15,23,42,0.06),0_12px_28px_-12px_rgba(15,23,42,0.22)] hover:-translate-y-px transition-all"
                      >
                        {/* Thumbnail — object-contain pour respecter les
                            ratios (portrait reels, carré, paysage) sans cropper
                            les bords. Fond glass neutre quand l'image n'occupe
                            pas tout le box. */}
                        <div className="shrink-0 w-[68px] h-[68px] rounded-lg bg-gradient-to-b from-gray-50/80 to-gray-100/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_0_1px_rgba(15,23,42,0.06)] overflow-hidden flex items-center justify-center">
                          {t.previewUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={t.previewUrl}
                              alt=""
                              loading="lazy"
                              className="max-w-full max-h-full w-auto h-auto object-contain"
                            />
                          ) : t.previewVideoUrl ? (
                            <video
                              src={t.previewVideoUrl}
                              muted
                              playsInline
                              preload="metadata"
                              className="max-w-full max-h-full w-auto h-auto object-contain"
                            />
                          ) : (
                            <LayoutTemplate size={20} className="text-gray-300" />
                          )}
                        </div>

                        {/* Body — nom + indicateur preview/Générer */}
                        <div className="min-w-0 flex-1 flex items-center justify-between gap-2">
                          <span className="min-w-0">
                            <span className="block text-[13px] font-medium text-gray-950 truncate">
                              {t.name}
                            </span>
                            <span className="block text-[10.5px] text-gray-400 mt-0.5">
                              {hasPreview ? "Dernière génération" : "Pas encore généré"}
                            </span>
                          </span>
                          <span className="inline-flex items-center gap-1 text-[11px] text-gray-500 group-hover:text-gray-950 transition-colors shrink-0">
                            Générer
                            <ArrowRight size={12} />
                          </span>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </section>
            )}

            {hasOtherTools && (
              <section className="rounded-2xl bg-gradient-to-b from-white/75 to-white/55 backdrop-blur-[8px] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08),0_2px_8px_-2px_rgba(15,23,42,0.06)]">
                <div className="flex items-center justify-between gap-2 mb-4">
                  <div>
                    <p className="text-[13px] font-semibold tracking-tight text-gray-950">
                      Mes outils
                    </p>
                    <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500 mt-0.5">
                      {otherTools.length} accès
                    </p>
                  </div>
                  <Wrench size={16} className="text-gray-400" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {otherTools.map((tool) => {
                    const meta = TOOL_META[tool];
                    return (
                      <Link
                        key={tool}
                        href={meta.href}
                        className="group flex items-start gap-3 px-4 py-3 rounded-xl bg-white shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08),0_2px_4px_rgba(15,23,42,0.04),0_8px_20px_-12px_rgba(15,23,42,0.14)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.14),0_4px_8px_rgba(15,23,42,0.06),0_12px_28px_-12px_rgba(15,23,42,0.22)] hover:-translate-y-px transition-all"
                      >
                        <span className="shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-md bg-gray-100/60 text-gray-700 group-hover:bg-gray-100 transition-colors">
                          <meta.Icon size={14} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-medium text-gray-950 truncate">
                            {TOOL_LABELS[tool]}
                          </p>
                          <p className="text-[11px] text-gray-500 truncate mt-0.5">
                            {TOOL_DESCRIPTIONS[tool]}
                          </p>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
