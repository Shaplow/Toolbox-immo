"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { useState, type ReactNode } from "react";
import { Home, List, Users, Type, MessageSquare, Library, LogOut } from "lucide-react";
import type { AppUserIdentity } from "@/lib/userContext";
import { TOOL_META, TOOL_ORDER } from "@/lib/toolMeta";

type NavItem = {
  href: string;
  label: string;
  icon: ReactNode;
};

type NavSection = {
  title?: string;
  items: NavItem[];
};

/** Build a NavItem from TOOL_META at nav icon size. */
function toolNavItem(key: keyof typeof TOOL_META): NavItem {
  const { href, navLabel, Icon } = TOOL_META[key];
  return { href, label: navLabel, icon: <Icon size={16} /> };
}

export function AppNav({
  actualUser,
  effectiveUser,
  isImpersonating,
}: {
  actualUser: AppUserIdentity;
  effectiveUser: AppUserIdentity;
  isImpersonating: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const canSeeAdmin = actualUser.role === "ADMIN";
  const navUser = isImpersonating ? effectiveUser : actualUser;
  const isAdminView = canSeeAdmin && !isImpersonating;

  // Parse user permissions (JSON string array on the user object)
  const rawPerms = navUser.permissions ?? "[]";
  let userPerms: string[] = [];
  try { userPerms = JSON.parse(rawPerms) as string[]; } catch { userPerms = []; }
  const hasCaptions = userPerms.includes("captions");
  const hasCovers = userPerms.includes("covers");
  const hasTranscription = userPerms.includes("transcription");
  const hasDescription = userPerms.includes("description");
  const hasDerush = userPerms.includes("derush");
  const hasTemplates =
    userPerms.includes("templates") ||
    userPerms.includes("templates:view") ||
    userPerms.includes("templates:generate") ||
    userPerms.includes("templates:edit") ||
    userPerms.includes("templates:manage");

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
          items: TOOL_ORDER.map(toolNavItem),
        },
        {
          title: "Suivi",
          items: [{ href: "/listings", label: "Mes générations", icon: <List size={16} /> }],
        },
        {
          title: "Admin",
          items: [
            { href: "/admin/users", label: "Utilisateurs", icon: <Users size={16} /> },
            { href: "/admin/fonts", label: "Typographies", icon: <Type size={16} /> },
            { href: "/admin/libraries", label: "Bibliothèques", icon: <Library size={16} /> },
            { href: "/admin/prompts", label: "Prompts IA", icon: <MessageSquare size={16} /> },
          ],
        },
      ]
    : [
        {
          items: [{ href: "/home", label: "Accueil", icon: <Home size={16} /> }],
        },
        {
          items: [
            ...(hasTemplates ? [toolNavItem("templates")] : []),
            ...(hasCaptions ? [toolNavItem("captions")] : []),
            ...(hasTranscription ? [toolNavItem("transcription")] : []),
            ...(hasDescription ? [toolNavItem("description")] : []),
            ...(hasDerush ? [toolNavItem("derush")] : []),
            ...(hasCovers ? [toolNavItem("covers")] : []),
          ],
        },
        {
          title: "Suivi",
          items: [{ href: "/listings", label: "Mes générations", icon: <List size={16} /> }],
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

      {/* Navigation */}
      <nav className={`flex-1 ${collapsed ? "px-2 py-3" : "px-3 py-4"}`}>
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
                {items.map(({ href, label, icon }) => {
                  const currentPath = pathname ?? "";
                  const active = currentPath === href || currentPath.startsWith(`${href}/`);
                  return (
                    <Link
                      key={href}
                      href={href}
                      title={label}
                      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                        active
                          ? "bg-indigo-50 text-indigo-700 font-medium"
                          : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                      } ${collapsed ? "justify-center px-0" : ""}`}
                    >
                      <span className="shrink-0 flex items-center">{icon}</span>
                      {!collapsed ? label : null}
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

