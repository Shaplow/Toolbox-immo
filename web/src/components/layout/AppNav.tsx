"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { useState, type ReactNode } from "react";
import { Home, List, Users, Library, LogOut, CalendarDays, Building2, LayoutTemplate, Instagram, RotateCw, Eye, ChevronDown } from "lucide-react";
import type { AppUserIdentity } from "@/lib/userContext";
import { TOOL_META } from "@/lib/toolMeta";
import { useWorklistCount } from "@/hooks/useWorklistCount";

type NavItem = {
  href: string;
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  /** Si true, l'item n'est actif que sur correspondance exacte de l'URL (pas startsWith). */
  exact?: boolean;
};

type NavSection = {
  title?: string;
  items: NavItem[];
};

/** Build a NavItem from TOOL_META at nav icon size. */
function toolNavItem(key: keyof typeof TOOL_META, opts?: { disabled?: boolean }): NavItem {
  const { href, navLabel, Icon } = TOOL_META[key];
  return { href, label: navLabel, icon: <Icon size={16} />, ...opts };
}

export function AppNav({
  actualUser,
  effectiveUser,
  isImpersonating,
  isRoleOverride = false,
}: {
  actualUser: AppUserIdentity;
  effectiveUser: AppUserIdentity;
  isImpersonating: boolean;
  isRoleOverride?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [viewAsMenuOpen, setViewAsMenuOpen] = useState(false);
  const { count: worklistCount } = useWorklistCount();
  const canSeeAdmin = actualUser.role === "ADMIN";
  // Quand l'admin est en mode "view-as", on rend la nav comme le rôle visé
  // (donc on utilise effectiveUser pour les checks de permissions).
  const navUser = isImpersonating || isRoleOverride ? effectiveUser : actualUser;
  // L'interface admin n'est visible QUE quand l'admin n'a aucun override actif.
  const isAdminView = canSeeAdmin && !isImpersonating && !isRoleOverride;

  async function setViewAsRole(role: "VIDEASTE" | "MONTEUR" | "CM" | null) {
    setViewAsMenuOpen(false);
    if (role === null) {
      await fetch("/api/admin/view-as", { method: "DELETE" });
    } else {
      await fetch("/api/admin/view-as", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
    }
    router.refresh();
  }

  // Parse user permissions (JSON string array on the user object)
  const rawPerms = navUser.permissions ?? "[]";
  let userPerms: string[] = [];
  try { userPerms = JSON.parse(rawPerms) as string[]; } catch { userPerms = []; }
  const hasCaptions = userPerms.includes("captions");
  const hasCovers = userPerms.includes("covers");
  const hasTranscription = userPerms.includes("transcription");
  const hasDescription = userPerms.includes("description");
  const hasTemplates = userPerms.includes("templates");

  async function stopImpersonation() {
    await fetch("/api/admin/impersonation", { method: "DELETE" });
    router.push("/admin/users");
    router.refresh();
  }

  const navSections: NavSection[] = isAdminView
    ? [
        {
          items: [{ href: "/home", label: "Accueil", icon: <Home size={16} /> }],
        },
        {
          title: "Suivi",
          items: [
            { href: "/listings", label: "Mes générations", icon: <List size={16} /> },
            { href: "/calendar", label: "Calendrier", icon: <CalendarDays size={16} /> },
          ],
        },
        {
          title: "Production",
          items: [
            { href: "/templates", label: "Templates", icon: <LayoutTemplate size={16} /> },
          ],
        },
        {
          title: "Clients",
          items: [
            { href: "/admin/clients", label: "Clients", icon: <Building2 size={16} /> },
            { href: "/admin/accounts", label: "Comptes Instagram", icon: <Instagram size={16} /> },
          ],
        },
        {
          title: "Configuration",
          items: [
            { href: "/admin/libraries", label: "Ressources", icon: <Library size={16} /> },
            { href: "/admin/users", label: "Utilisateurs", icon: <Users size={16} /> },
            { href: "/admin/jobs", label: "Jobs actifs", icon: <RotateCw size={16} /> },
          ],
        },
      ]
    : [
        {
          items: [{ href: "/home", label: "Accueil", icon: <Home size={16} /> }],
        },
        {
          title: "Outils",
          items: [
            ...(hasTemplates ? [toolNavItem("templates")] : []),
            ...(hasTranscription ? [toolNavItem("transcription")] : []),
            ...(hasCaptions ? [toolNavItem("captions")] : []),
            ...(hasDescription ? [toolNavItem("description")] : []),
            ...(hasCovers ? [toolNavItem("covers")] : []),
          ],
        },
        {
          title: "Suivi",
          items: [
            { href: "/listings", label: "Mes générations", icon: <List size={16} /> },
          ],
        },
      ];

  return (
    <aside className={`bg-white border-r border-gray-100 flex flex-col h-full shrink-0 transition-[width] duration-200 ${collapsed ? "w-16" : "w-56"}`}>
      {/* Logo */}
      <div className={`border-b border-gray-100 ${collapsed ? "px-3 py-4" : "px-5 py-5"}`}>
        <div className={`flex ${collapsed ? "flex-col items-center gap-2" : "items-center justify-between gap-2"}`}>
          <div className={`flex items-center ${collapsed ? "justify-center" : "gap-2"}`}>
            <span className="w-7 h-7 bg-indigo-600 rounded-lg flex items-center justify-center text-white text-sm font-bold">T</span>
            {!collapsed ? <span className="font-semibold text-gray-900 text-sm">Toolbox Immo</span> : null}
          </div>
          <button
            type="button"
            onClick={() => setCollapsed((current) => !current)}
            title={collapsed ? "Ouvrir la navigation" : "Réduire la navigation"}
            className="shrink-0 h-8 w-8 rounded-lg border border-gray-200 text-gray-500 hover:border-indigo-300 hover:text-indigo-700"
          >
            {collapsed ? "›" : "‹"}
          </button>
        </div>
      </div>

      {isImpersonating && (
        <div className={collapsed ? "px-2 py-2 border-b border-gray-100" : "px-3 py-3 border-b border-gray-100"}>
          <div className={`rounded-xl border border-amber-200 bg-amber-50 ${collapsed ? "p-2" : "p-3"}`}>
            {!collapsed ? (
              <>
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-700">Impersonation</p>
                <p className="mt-1 text-xs font-medium text-amber-900 truncate">{effectiveUser.name ?? effectiveUser.email ?? effectiveUser.id}</p>
                <button
                  type="button"
                  onClick={() => void stopImpersonation()}
                  className="mt-2 text-xs text-amber-800 hover:text-amber-950 font-medium"
                >
                  Quitter
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => void stopImpersonation()}
                title="Quitter l'impersonation"
                className="w-full text-xs text-amber-800 hover:text-amber-950"
              >
                ↩
              </button>
            )}
          </div>
        </div>
      )}

      {/* Switch de vue ADMIN — bascule entre interface admin et vues
          d'autres rôles (VIDÉASTE/MONTEUR/CM) sur ses propres slots assignés.
          Visible uniquement pour un ADMIN réel pas en impersonation. */}
      {canSeeAdmin && !isImpersonating && !collapsed && (
        <div className="px-3 py-3 border-b border-gray-100 relative">
          <button
            type="button"
            onClick={() => setViewAsMenuOpen((o) => !o)}
            className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${
              isRoleOverride
                ? "border-fuchsia-300 bg-fuchsia-50 text-fuchsia-800 hover:bg-fuchsia-100"
                : "border-gray-200 bg-white text-gray-700 hover:border-indigo-300 hover:text-indigo-700"
            }`}
          >
            <span className="flex items-center gap-2 min-w-0">
              <Eye size={13} className="shrink-0" />
              <span className="truncate">
                Vue : {isRoleOverride ? effectiveUser.role : "Admin"}
              </span>
            </span>
            <ChevronDown size={12} className="shrink-0" />
          </button>
          {viewAsMenuOpen && (
            <div
              className="absolute left-3 right-3 top-full mt-1 z-20 rounded-lg border border-gray-200 bg-white shadow-lg overflow-hidden"
              onMouseLeave={() => setViewAsMenuOpen(false)}
            >
              <button
                type="button"
                onClick={() => void setViewAsRole(null)}
                className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 ${!isRoleOverride ? "bg-indigo-50 text-indigo-700 font-medium" : "text-gray-700"}`}
              >
                Admin <span className="text-gray-400 ml-1">(par défaut)</span>
              </button>
              {([
                ["VIDEASTE", "Vidéaste"],
                ["MONTEUR", "Monteur"],
                ["CM", "CM"],
              ] as const).map(([role, label]) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => void setViewAsRole(role)}
                  className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 border-t border-gray-100 ${
                    isRoleOverride && effectiveUser.role === role
                      ? "bg-fuchsia-50 text-fuchsia-700 font-medium"
                      : "text-gray-700"
                  }`}
                >
                  Vue {label}
                  <span className="text-gray-400 ml-1 text-[10px]">
                    (mes slots assignés)
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Navigation */}
      <nav className={`flex-1 min-h-0 overflow-y-auto ${collapsed ? "px-2 py-3" : "px-3 py-4"}`}>
        {navSections.map(({ title, items }, index) => {
          if (items.length === 0) return null;

          return (
            <div key={title ?? `section-${index}`} className={index === 0 ? "" : collapsed ? "mt-3 pt-3 border-t border-gray-100" : "mt-5 pt-4 border-t border-gray-100"}>
              {title && !collapsed && (
                <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">
                  {title}
                </p>
              )}
              <div className="space-y-1">
                {items.map(({ href, label, icon, disabled, exact }) => {
                  const currentPath = pathname ?? "";
                  const active = !disabled && (
                    currentPath === href ||
                    (!exact && currentPath.startsWith(`${href}/`))
                  );
                  if (disabled) {
                    return (
                      <span
                        key={href}
                        title={label}
                        className={`flex items-center gap-2.5 py-2 rounded-lg text-sm cursor-not-allowed select-none text-gray-300 ${collapsed ? "justify-center px-0" : "px-3"}`}
                      >
                        <span className="shrink-0 flex items-center">{icon}</span>
                        {!collapsed ? <span className="flex items-center gap-1.5">{label}<span className="text-[10px] font-medium bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded-md">Bientôt</span></span> : null}
                      </span>
                    );
                  }
                  const isHome = href === "/home";
                  const showBadge = isHome && worklistCount > 0;
                  return (
                    <Link
                      key={href}
                      href={href}
                      title={isHome && showBadge ? `${label} (${worklistCount})` : label}
                      className={`flex items-center gap-2.5 py-2 rounded-lg text-sm transition-colors ${
                        active
                          ? "bg-indigo-50 text-indigo-700 font-medium"
                          : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                      } ${collapsed ? "justify-center px-0" : "px-3"}`}
                    >
                      <span className="shrink-0 flex items-center relative">
                        {icon}
                        {/* Point pastille en nav collapsée */}
                        {showBadge && collapsed && (
                          <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-indigo-600 ring-2 ring-white" />
                        )}
                      </span>
                      {!collapsed ? (
                        <span className="flex-1 flex items-center justify-between">
                          {label}
                          {/* Badge pill en nav ouverte */}
                          {showBadge && (
                            <span className="ml-1.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-indigo-600 text-white text-[10px] font-semibold leading-none px-1">
                              {worklistCount > 99 ? "99+" : worklistCount}
                            </span>
                          )}
                        </span>
                      ) : null}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      {/* User footer */}
      <div className={`border-t border-gray-100 ${collapsed ? "px-2 py-3" : "px-4 py-4"}`}>
        {!collapsed ? <p className="text-xs text-gray-500 truncate mb-0.5">{navUser.name ?? navUser.email}</p> : null}
        {!collapsed && canSeeAdmin ? (
          <p className="text-[10px] text-indigo-700 mb-2">{isImpersonating ? "Admin en mode utilisateur" : "Administrateur"}</p>
        ) : null}
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          title="Se déconnecter"
          className={`text-xs text-gray-400 hover:text-red-500 transition-colors ${collapsed ? "w-full rounded-lg border border-gray-200 py-2 flex items-center justify-center" : "w-full text-left"}`}
        >
          {collapsed ? <LogOut size={14} /> : "Se déconnecter"}
        </button>
      </div>
    </aside>
  );
}

