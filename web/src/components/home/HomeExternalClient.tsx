import Link from "next/link";
import { LayoutTemplate, ShieldAlert, ArrowRight, Wrench } from "lucide-react";
import { TOOL_LABELS, TOOL_DESCRIPTIONS, type Tool } from "@/lib/permissions";
import { TOOL_META } from "@/lib/toolMeta";

// parsePermissions inliné — évite de pull userContext.ts (qui importe
// next/headers et casse le bundle client). Même approche que tools.ts.
function parsePermissions(raw: string | null | undefined): string[] {
  try {
    return JSON.parse(raw ?? "[]") as string[];
  } catch {
    return [];
  }
}

export interface HomeExternalClientAccess {
  templates: Array<{ id: string; name: string }>;
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
 * Ces utilisateurs ne font pas partie de l'équipe éditoriale — ils ont juste
 * accès à un ou plusieurs templates pour générer manuellement du contenu.
 *
 * Affiche :
 *  1. CTA "Mes générations" → /listings (historique de leurs renders)
 *  2. Liste des templates accessibles (click → /generate/[id])
 *  3. Liste des outils granulaires éventuellement attribués (covers, etc.)
 *
 * Out of scope : presets sous-titres (réservés à l'équipe interne), pipeline
 * éditoriale (calendrier, fiches publications).
 */
export function HomeExternalClient({ permissions, access }: HomeExternalClientProps) {
  const userPerms = parsePermissions(permissions) as Tool[];
  const knownTools = userPerms.filter((p): p is Tool => p in TOOL_LABELS);
  // Le tool TEMPLATES est exposé via la section dédiée ci-dessous —
  // on l'exclut de la section "Mes outils" pour ne pas le dupliquer.
  const otherTools = knownTools.filter((t) => t !== "templates");
  const hasOtherTools = otherTools.length > 0;
  const hasTemplates = access.templates.length > 0;
  const hasAnyAccess = hasOtherTools || hasTemplates;

  if (!hasAnyAccess) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 flex flex-col items-center text-center gap-6">
        <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center">
          <ShieldAlert size={22} className="text-amber-500" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Aucun accès actif</h1>
          <p className="text-sm text-gray-500 leading-relaxed">
            Aucun template ne vous a été attribué pour le moment. Contactez
            votre administrateur pour activer vos accès.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-12 flex flex-col gap-8">
      <header className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">
            <Wrench size={22} className="text-indigo-500" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Bienvenue</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Vos templates et générations en un coup d&apos;œil.
            </p>
          </div>
        </div>
        <Link
          href="/listings"
          className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-50 text-indigo-700 text-sm font-medium hover:bg-indigo-100 transition-colors shrink-0"
        >
          Mes générations
          <ArrowRight size={14} />
        </Link>
      </header>

      {/* CTA mobile (l'inline est masqué en xs) */}
      <Link
        href="/listings"
        className="sm:hidden inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-50 text-indigo-700 text-sm font-medium hover:bg-indigo-100 transition-colors"
      >
        Mes générations
        <ArrowRight size={14} />
      </Link>

      {hasTemplates && (
        <section className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <LayoutTemplate size={16} className="text-gray-400" />
            <h2 className="text-sm font-semibold text-gray-700">
              Templates accessibles
            </h2>
            <span className="text-xs text-gray-400">
              ({access.templates.length})
            </span>
          </div>
          <ul className="space-y-1">
            {access.templates.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/generate/${t.id}`}
                  className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-indigo-50 hover:text-indigo-700 transition-colors"
                >
                  <span className="truncate">{t.name}</span>
                  <span className="text-xs text-gray-400 shrink-0">Générer</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {hasOtherTools && (
        <section className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <Wrench size={16} className="text-gray-400" />
            <h2 className="text-sm font-semibold text-gray-700">Mes outils</h2>
            <span className="text-xs text-gray-400">({otherTools.length})</span>
          </div>
          <ul className="space-y-1">
            {otherTools.map((tool) => {
              const meta = TOOL_META[tool];
              return (
                <li key={tool}>
                  <Link
                    href={meta.href}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-indigo-50 hover:text-indigo-700 transition-colors"
                  >
                    <meta.Icon size={16} className="text-gray-400 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm text-gray-700 truncate">
                        {TOOL_LABELS[tool]}
                      </p>
                      <p className="text-xs text-gray-400 truncate">
                        {TOOL_DESCRIPTIONS[tool]}
                      </p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
