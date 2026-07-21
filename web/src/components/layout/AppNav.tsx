"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useImpersonation } from "@/hooks/useImpersonation";
import { type ReactNode } from "react";
import {
  Home,
  Users,
  Library,
  LogOut,
  CalendarDays,
  Building2,
  Clapperboard,
  Instagram,
  RotateCw,
  Sparkles,
  Eye,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Search,
  Hammer,
  History,
  MoreHorizontal,
  MapPin,
} from "lucide-react";
import { KbdChord } from "@/components/ui/Kbd";
import type { AppUserIdentity } from "@/lib/userContext";
import { canAccessTool } from "@/lib/permissions/tools";
import { canAccessMediaLibrary } from "@/lib/permissions/mediaLibrary";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { DropdownMenu } from "@/components/ui/DropdownMenu";

/**
 * AppNav — navigation latérale principale flat shadcn.
 *
 * - Wordmark "Team PDC" en Geist semibold (sans serif neutre).
 * - Items actifs : bg-accent text-accent-foreground (pas de glass).
 * - Search button + user footer : flat bg-card border.
 * - Collapse persisté via localStorage.
 * - Section Admin repliable (collapsed par défaut, persisté).
 */

type NavItem = {
  href: string;
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  exact?: boolean;
  /** Préfixes de chemin supplémentaires qui marquent cet item comme actif
   *  (ex: "Atelier" (/outils) reste actif sur les pages d'un outil : /missions). */
  matchPaths?: string[];
};

type NavSection = {
  title?: string;
  items: NavItem[];
  collapsible?: { key: string; defaultOpen: boolean };
};

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
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem("toolbox_nav_collapsed");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored === "true") setCollapsed(true);
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("toolbox_nav_collapsed", String(collapsed));
  }, [collapsed]);
  const [adminSectionCollapsed, setAdminSectionCollapsed] = useState(true);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem("toolbox_nav_admin_collapsed");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored === "false") setAdminSectionCollapsed(false);
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      "toolbox_nav_admin_collapsed",
      String(adminSectionCollapsed),
    );
  }, [adminSectionCollapsed]);
  const { setViewAsRole } = useImpersonation();

  const canSeeAdmin = actualUser.role === "ADMIN";
  const navUser = isImpersonating || isRoleOverride ? effectiveUser : actualUser;
  const isAdminView = canSeeAdmin && !isImpersonating && !isRoleOverride;

  // canAccessTool honore le scope de rôle ET les permissions individuelles →
  // cohérent avec le hub Atelier et le gate serveur (hasTool). Inclut "mission".
  const hasAnyToolPerm = ["templates", "captions", "covers", "transcription", "description", "mission"].some(
    (t) => canAccessTool(navUser, t),
  );

  const isExternalGenerator = navUser.role === "EXTERNAL_GENERATOR";

  let navSections: NavSection[];

  if (isAdminView) {
    navSections = [
      {
        items: [{ href: "/home", label: "Accueil", icon: <Home size={14} /> }],
      },
      {
        title: "Planification",
        items: [
          { href: "/calendar", label: "Calendrier", icon: <CalendarDays size={14} /> },
          { href: "/admin/accounts", label: "Comptes Instagram", icon: <Instagram size={14} /> },
          { href: "/admin/libraries", label: "Médiathèque", icon: <Library size={14} /> },
          { href: "/biens", label: "Biens", icon: <MapPin size={14} /> },
        ],
      },
      {
        title: "Production",
        items: [
          { href: "/templates", label: "Studio", icon: <Clapperboard size={14} /> },
          { href: "/outils", label: "Atelier", icon: <Hammer size={14} />, matchPaths: ["/missions"] },
          { href: "/listings", label: "Mes générations", icon: <History size={14} /> },
        ],
      },
      {
        title: "Configuration",
        collapsible: { key: "admin", defaultOpen: false },
        items: [
          { href: "/admin/patterns", label: "Recettes", icon: <Sparkles size={14} /> },
          { href: "/admin/clients", label: "Clients", icon: <Building2 size={14} /> },
          { href: "/admin/users", label: "Utilisateurs", icon: <Users size={14} /> },
          { href: "/admin/jobs", label: "Jobs actifs", icon: <RotateCw size={14} /> },
        ],
      },
    ];
  } else if (isExternalGenerator) {
    navSections = [
      {
        items: [
          { href: "/home", label: "Accueil", icon: <Home size={14} /> },
          { href: "/listings", label: "Mes générations", icon: <History size={14} /> },
        ],
      },
    ];
  } else {
    navSections = [
      {
        items: [
          { href: "/home", label: "Accueil", icon: <Home size={14} /> },
          // Médiathèque : ouverte au VIDEASTE (gestion des assets média + audio).
          // canAccessMediaLibrary = false pour MONTEUR/CM → l'item leur reste caché.
          ...(canAccessMediaLibrary(navUser.role)
            ? [{ href: "/admin/libraries", label: "Médiathèque", icon: <Library size={14} /> }]
            : []),
          ...(hasAnyToolPerm
            ? [{ href: "/outils", label: "Atelier", icon: <Hammer size={14} />, matchPaths: ["/missions"] }]
            : []),
          { href: "/listings", label: "Mes générations", icon: <History size={14} /> },
        ],
      },
    ];
  }

  // "Team PDC" partout sauf EXTERNAL_GENERATOR (voit son propre nom).
  const wordmark = isExternalGenerator
    ? (navUser.name?.trim() || "Mon espace")
    : "Team PDC";

  const viewAsRoleLabel = isRoleOverride
    ? effectiveUser.role === "VIDEASTE"
      ? "Vidéaste"
      : effectiveUser.role === "MONTEUR"
        ? "Monteur"
        : effectiveUser.role === "CM"
          ? "CM"
          : "Admin"
    : "Admin";

  return (
    <aside
      className={[
        "relative flex flex-col h-screen shrink-0 transition-[width] duration-200",
        collapsed ? "w-14" : "w-60",
      ].join(" ")}
    >
      {/* Header wordmark + collapse */}
      <div
        className={[
          "shrink-0 pt-6",
          collapsed ? "px-2 pb-4" : "px-4 pb-4",
        ].join(" ")}
      >
        {collapsed ? (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus-ring"
              aria-label="Ouvrir la navigation"
              title="Ouvrir"
            >
              <ChevronRight size={14} strokeWidth={2} />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <Link
              href="/home"
              className="inline-flex items-center px-2 py-1 -mx-2 -my-1 rounded-md focus-ring transition-colors hover:bg-muted min-w-0"
              title={`${wordmark} · Accueil`}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold tracking-tight text-foreground leading-none truncate">
                  {wordmark}
                </span>
                {isRoleOverride && (
                  <span className="mt-1 inline-flex items-center gap-1 text-[9px] uppercase tracking-widest text-warning-700 font-semibold">
                    <span className="h-1.5 w-1.5 rounded-full bg-warning-600" />
                    Vue {viewAsRoleLabel}
                  </span>
                )}
              </span>
            </Link>
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              className="shrink-0 inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus-ring"
              aria-label="Réduire la navigation"
              title="Réduire"
            >
              <ChevronLeft size={14} strokeWidth={2} />
            </button>
          </div>
        )}
      </div>

      {/* Search button (⌘K) */}
      <div className={collapsed ? "px-2 pb-3" : "px-4 pb-3"}>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("palette:open"))}
          className={[
            "w-full flex items-center gap-2 h-9 rounded-md text-[13px] transition-colors focus-ring",
            "bg-card border border-input text-muted-foreground hover:bg-muted hover:text-foreground",
            collapsed ? "justify-center px-0" : "justify-between px-2.5",
          ].join(" ")}
          aria-label="Rechercher (Cmd+K)"
          title="Rechercher (⌘K)"
        >
          <span className="inline-flex items-center gap-2 min-w-0">
            <Search size={14} className="shrink-0" />
            {!collapsed && <span>Rechercher</span>}
          </span>
          {!collapsed && <KbdChord keys={["⌘", "K"]} size="sm" />}
        </button>
      </div>

      {/* Navigation principale */}
      <nav className={`flex-1 min-h-0 overflow-y-auto ${collapsed ? "px-2 py-2" : "px-4 py-2"} [scrollbar-width:thin]`}>
        {navSections.map(({ title, items, collapsible }, index) => {
          if (items.length === 0) return null;
          const isCollapsibleAdmin =
            collapsible?.key === "admin" && !collapsed;
          const sectionIsCollapsed =
            isCollapsibleAdmin && adminSectionCollapsed;
          return (
            <div
              key={title ?? `section-${index}`}
              className={index === 0 ? "" : collapsed ? "mt-3" : "mt-4"}
            >
              {title && !collapsed && (
                isCollapsibleAdmin ? (
                  <button
                    type="button"
                    onClick={() => setAdminSectionCollapsed((v) => !v)}
                    className="w-full inline-flex items-center justify-between gap-1 px-2 pb-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors focus-ring rounded"
                    aria-expanded={!sectionIsCollapsed}
                    title={sectionIsCollapsed ? `Ouvrir ${title}` : `Replier ${title}`}
                  >
                    <span>{title}</span>
                    {sectionIsCollapsed ? (
                      <ChevronDown size={11} strokeWidth={2.5} />
                    ) : (
                      <ChevronUp size={11} strokeWidth={2.5} />
                    )}
                  </button>
                ) : (
                  <p className="px-2 pb-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                    {title}
                  </p>
                )
              )}
              {!sectionIsCollapsed && (
                <div className="space-y-0.5">
                  {items.map((item) => (
                    <NavItemLink
                      key={item.href}
                      item={item}
                      pathname={pathname ?? ""}
                      collapsed={collapsed}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* User footer */}
      <div className={collapsed ? "pt-2 pb-6 px-2 flex justify-center" : "px-4 pt-3 pb-6"}>
        {(() => {
          type MenuItem =
            | { label: string; icon?: typeof Hammer; onClick: () => void; destructive?: boolean; kbd?: string }
            | "separator";
          const menuItems: MenuItem[] = [];

          if (canSeeAdmin && !isImpersonating) {
            menuItems.push({
              label: isRoleOverride ? "Vue : Admin (revenir)" : "Vue : Admin",
              icon: Eye,
              onClick: () => void setViewAsRole(null),
            });
            menuItems.push({ label: "Vue Vidéaste", onClick: () => void setViewAsRole("VIDEASTE") });
            menuItems.push({ label: "Vue Monteur",  onClick: () => void setViewAsRole("MONTEUR") });
            menuItems.push({ label: "Vue CM",       onClick: () => void setViewAsRole("CM") });
          }

          if (menuItems.length > 0) menuItems.push("separator");
          menuItems.push({
            label: "Se déconnecter",
            icon: LogOut,
            destructive: true,
            onClick: () => signOut({ callbackUrl: "/login" }),
          });

          if (collapsed) {
            return (
              <DropdownMenu
                align="end"
                trigger={
                  <button type="button" className="relative inline-flex rounded-full focus-ring" title={navUser.name ?? navUser.email ?? "Profil"}>
                    <Avatar
                      name={navUser.name ?? navUser.email ?? "?"}
                      size="md"
                      status={isImpersonating ? "away" : undefined}
                      ring={isRoleOverride}
                    />
                    {isRoleOverride && (
                      <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-warning-600 ring-2 ring-card" />
                    )}
                  </button>
                }
                items={menuItems}
              />
            );
          }

          const roleRaw = isImpersonating
            ? `${navUser.role ?? "User"}`
            : isRoleOverride
              ? viewAsRoleLabel
              : (navUser.role ?? "User");
          const roleLabel =
            roleRaw.toLowerCase() === "admin" ? "Admin"
            : roleRaw === "VIDEASTE" ? "Vidéaste"
            : roleRaw === "MONTEUR"  ? "Monteur"
            : roleRaw === "CM"       ? "CM"
            : roleRaw.charAt(0) + roleRaw.slice(1).toLowerCase();

          return (
            <DropdownMenu
              align="end"
              side="top"
              trigger={
                <button
                  type="button"
                  className="w-full inline-flex items-center gap-3 p-2.5 rounded-md bg-card border border-border hover:bg-muted transition-colors focus-ring text-left"
                >
                  <Avatar
                    name={navUser.name ?? navUser.email ?? "?"}
                    size="md"
                    status={isImpersonating ? "away" : undefined}
                    ring={isRoleOverride}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-foreground truncate leading-tight">
                      {navUser.name ?? navUser.email}
                    </p>
                    <p className="mt-0.5 inline-flex items-center gap-1.5 truncate">
                      <Badge size="sm">{roleLabel}</Badge>
                      {(isImpersonating || isRoleOverride) && (
                        <span className="text-[10px] text-muted-foreground truncate">
                          {isImpersonating ? "via admin" : "vue"}
                        </span>
                      )}
                    </p>
                  </div>
                  <MoreHorizontal size={15} className="text-muted-foreground shrink-0" />
                </button>
              }
              items={menuItems}
            />
          );
        })()}
      </div>
    </aside>
  );
}

function NavItemLink({
  item,
  pathname,
  collapsed,
}: {
  item: NavItem;
  pathname: string;
  collapsed: boolean;
}) {
  const active =
    !item.disabled &&
    (pathname === item.href ||
      (!item.exact && pathname.startsWith(`${item.href}/`)) ||
      (item.matchPaths ?? []).some(
        (p) => pathname === p || pathname.startsWith(`${p}/`),
      ));

  if (item.disabled) {
    return (
      <span
        title={item.label}
        className={`flex items-center gap-2 h-8 rounded-md text-[13px] cursor-not-allowed select-none text-muted-foreground/60 ${
          collapsed ? "justify-center px-0" : "justify-start px-2"
        }`}
      >
        <span className="shrink-0 flex items-center">{item.icon}</span>
        {!collapsed && (
          <span className="inline-flex items-center gap-1.5">
            <span>{item.label}</span>
            <Badge size="sm">bientôt</Badge>
          </span>
        )}
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      title={item.label}
      className={[
        "relative flex items-center gap-2.5 h-9 rounded-md text-[13px] transition-colors focus-ring",
        active
          ? "bg-accent text-accent-foreground font-medium"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
        collapsed ? "justify-center px-0" : "justify-start px-2.5",
      ].join(" ")}
    >
      <span className="shrink-0 flex items-center">{item.icon}</span>
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  );
}
