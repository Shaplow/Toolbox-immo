import Link from "next/link";
import { redirect } from "next/navigation";

import { getUserContext, parsePermissions } from "@/lib/userContext";
import { TOOL_META, TOOL_ORDER, type ToolKey } from "@/lib/toolMeta";
import { ROLE_TOOL_SCOPE, ROLE_TOOL_SCOPE_ALL } from "@/lib/permissions/tools";
import type { UserRole } from "@/types/roles";

// ---------------------------------------------------------------------------
// Color maps (reprises de l'ancien /home)
// ---------------------------------------------------------------------------

const colorMap: Record<string, string> = {
  indigo:  "bg-indigo-50 border-indigo-100 hover:border-indigo-300 group-hover:text-indigo-700",
  violet:  "bg-violet-50 border-violet-100 hover:border-violet-300 group-hover:text-violet-600",
  emerald: "bg-emerald-50 border-emerald-100 hover:border-emerald-300 group-hover:text-emerald-700",
  teal:    "bg-teal-50 border-teal-100 hover:border-teal-300 group-hover:text-teal-700",
  amber:   "bg-amber-50 border-amber-100 hover:border-amber-300 group-hover:text-amber-700",
  rose:    "bg-rose-50 border-rose-100 hover:border-rose-300 group-hover:text-rose-700",
};

const iconColorMap: Record<string, string> = {
  indigo:  "bg-indigo-100 text-indigo-700",
  violet:  "bg-violet-100 text-violet-600",
  emerald: "bg-emerald-100 text-emerald-700",
  teal:    "bg-teal-100 text-teal-700",
  amber:   "bg-amber-100 text-amber-700",
  rose:    "bg-rose-100 text-rose-700",
};

const badgeColorMap: Record<string, string> = {
  indigo:  "bg-indigo-100 text-indigo-700",
  violet:  "bg-violet-100 text-violet-700",
  emerald: "bg-emerald-100 text-emerald-700",
  teal:    "bg-teal-100 text-teal-700",
  amber:   "bg-amber-100 text-amber-700",
  rose:    "bg-rose-100 text-rose-700",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Mappe une ToolKey (clé TOOL_META) vers la clé utilisée dans ROLE_TOOL_SCOPE.
 * TOOL_META utilise "covers", ROLE_TOOL_SCOPE utilise "cover".
 */
function toolKeyToScopeKey(key: ToolKey): string {
  // covers → cover (normalisation pour correspondre à ROLE_TOOL_SCOPE CM/MONTEUR)
  if (key === "covers") return "cover";
  return key;
}

/**
 * Détermine les ToolKeys visibles pour l'utilisateur effectif.
 *
 * - ADMIN : tous les outils.
 * - MONTEUR / CM : outils du ROLE_TOOL_SCOPE de leur rôle, plus éventuels outils
 *   individuels accordés via permissions JSON (OR entre les deux sources).
 * - USER (et rôle inconnu) : comportement legacy — uniquement les outils
 *   accordés via User.permissions (JSON array).
 */
function getVisibleToolKeys(
  role: string,
  userPerms: string[],
): ToolKey[] {
  const roleScope = ROLE_TOOL_SCOPE[role as UserRole] ?? [];

  return TOOL_ORDER.filter((key) => {
    // ADMIN : tout
    if (roleScope === ROLE_TOOL_SCOPE_ALL) return true;

    const scopeKey = toolKeyToScopeKey(key);

    // Rôle MONTEUR/CM : scope de rôle OU permissions individuelles
    if (Array.isArray(roleScope) && roleScope.length > 0) {
      if ((roleScope as readonly string[]).includes(scopeKey)) return true;
    }

    // Permissions individuelles (USER legacy ou cumul ponctuel pour MONTEUR/CM)
    if (key === "templates") {
      return (
        userPerms.includes("templates") ||
        userPerms.includes("templates:view") ||
        userPerms.includes("templates:generate") ||
        userPerms.includes("templates:edit") ||
        userPerms.includes("templates:manage")
      );
    }
    return userPerms.includes(scopeKey);
  });
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function ToolsPage() {
  const userContext = await getUserContext();
  if (!userContext) redirect("/login");

  const { effectiveUser } = userContext;
  const userPerms = parsePermissions(effectiveUser.permissions);
  const visibleKeys = getVisibleToolKeys(effectiveUser.role, userPerms);

  const visibleTools = visibleKeys.map((key) => {
    const { href, cardLabel, description, Icon, color, badge } = TOOL_META[key];
    return { key, href, label: cardLabel, description, Icon, color, badge };
  });

  return (
    <div className="flex flex-col items-center justify-center min-h-full px-6 py-16">
      {/* Header */}
      <div className="text-center mb-12">
        <div className="inline-flex items-center justify-center w-14 h-14 bg-indigo-600 rounded-2xl mb-5 shadow-md">
          <span className="text-2xl font-bold text-white">T</span>
        </div>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Outils</h1>
        <p className="text-gray-500 text-base max-w-sm mx-auto">
          Bonjour{effectiveUser.name ? ` ${effectiveUser.name.split(" ")[0]}` : ""} — choisissez un outil pour commencer.
        </p>
      </div>

      {/* Tool cards */}
      {visibleTools.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 w-full max-w-2xl">
          {visibleTools.map(({ key, href, label, description, Icon, color, badge }) => (
            <Link
              key={key}
              href={href}
              className={`group relative flex flex-col p-6 rounded-2xl border-2 transition-all duration-200 cursor-pointer ${colorMap[color]}`}
            >
              {badge && (
                <span className={`absolute top-4 right-4 text-[10px] font-semibold px-2 py-0.5 rounded-full ${badgeColorMap[color]}`}>
                  {badge}
                </span>
              )}
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-4 ${iconColorMap[color]}`}>
                <Icon size={20} />
              </div>
              <h2 className={`text-base font-semibold text-gray-900 mb-1.5 transition-colors ${colorMap[color].split(" ").at(-1)}`}>
                {label}
              </h2>
              <p className="text-sm text-gray-500 leading-relaxed">{description}</p>
              <div className="mt-4 text-xs font-medium text-gray-400 group-hover:text-gray-600 transition-colors">
                Ouvrir &rarr;
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="text-center text-sm text-gray-400 max-w-sm">
          Aucun outil n&apos;est disponible pour votre compte. Contactez votre administrateur.
        </div>
      )}
    </div>
  );
}
