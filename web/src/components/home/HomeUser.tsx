import Link from "next/link";
import { LayoutTemplate, Sparkles, ShieldAlert, Wrench } from "lucide-react";
import { parsePermissions } from "@/lib/userContext";
import { TOOL_LABELS, TOOL_DESCRIPTIONS, type Tool } from "@/lib/permissions";
import { TOOL_META } from "@/lib/toolMeta";

export interface HomeUserAccess {
  templates: Array<{ id: string; name: string }>;
  captionPresets: Array<{ id: string; name: string }>;
}

interface HomeUserProps {
  /** Valeur brute de User.permissions (JSON array en base). */
  permissions: string;
  /** Ressources auxquelles l'utilisateur a accès (assignées par un admin). */
  access: HomeUserAccess;
}

/**
 * Page d'accueil pour le rôle USER — pensée comme un accès "générateur
 * externe" : l'utilisateur ne fait pas partie de l'équipe éditoriale
 * (Monteur/CM), mais peut générer du contenu sur des templates précis
 * et utiliser quelques outils granulaires qui lui ont été attribués.
 *
 * Affiche : message d'accueil + liste des accès (templates, presets,
 * outils granulaires). Si aucun accès actif, indique qui contacter.
 */
export function HomeUser({ permissions, access }: HomeUserProps) {
  const userPerms = parsePermissions(permissions) as Tool[];
  const knownTools = userPerms.filter((p): p is Tool => p in TOOL_LABELS);
  const hasTools = knownTools.length > 0;
  const hasTemplates = access.templates.length > 0;
  const hasPresets = access.captionPresets.length > 0;
  const hasAnyAccess = hasTools || hasTemplates || hasPresets;

  if (!hasAnyAccess) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 flex flex-col items-center text-center gap-6">
        <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center">
          <ShieldAlert size={22} className="text-amber-500" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Aucun accès actif</h1>
          <p className="text-sm text-gray-500 leading-relaxed">
            Aucun template, preset ou outil ne vous a été attribué pour
            le moment. Contactez votre administrateur pour activer vos accès.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-12 flex flex-col gap-8">
      <header className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">
          <Wrench size={22} className="text-indigo-500" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Bienvenue</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Voici les ressources qui vous ont été attribuées.
          </p>
        </div>
      </header>

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

      {hasPresets && (
        <section className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles size={16} className="text-gray-400" />
            <h2 className="text-sm font-semibold text-gray-700">
              Presets sous-titres
            </h2>
            <span className="text-xs text-gray-400">
              ({access.captionPresets.length})
            </span>
          </div>
          <ul className="space-y-1">
            {access.captionPresets.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/captions/${p.id}/generate`}
                  className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-indigo-50 hover:text-indigo-700 transition-colors"
                >
                  <span className="truncate">{p.name}</span>
                  <span className="text-xs text-gray-400 shrink-0">Générer</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {hasTools && (
        <section className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <Wrench size={16} className="text-gray-400" />
            <h2 className="text-sm font-semibold text-gray-700">Mes outils</h2>
            <span className="text-xs text-gray-400">({knownTools.length})</span>
          </div>
          <ul className="space-y-1">
            {knownTools.map((tool) => {
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
