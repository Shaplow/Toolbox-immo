"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useImpersonation } from "@/hooks/useImpersonation";
import { type ReactNode } from "react";
import {
  Home,
  List,
  Users,
  Library,
  LogOut,
  CalendarDays,
  Building2,
  LayoutTemplate,
  Instagram,
  RotateCw,
  Eye,
  PanelLeftClose,
  PanelLeft,
  Search,
} from "lucide-react";
import type { AppUserIdentity } from "@/lib/userContext";
import { parsePermissions } from "@/lib/permissions/parsePermissions";
import { TOOL_META } from "@/lib/toolMeta";
import { useWorklistCount } from "@/hooks/useWorklistCount";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ButtonIcon } from "@/components/ui/ButtonIcon";
import { DropdownMenu } from "@/components/ui/DropdownMenu";
import { Kbd } from "@/components/ui/Kbd";
import { Tooltip } from "@/components/ui/Tooltip";

/**
 * AppNav — navigation latérale principale.
 *
 * Décisions UX (Phase 3 du chantier ui-boost) :
 *  1. Logo = carré bg-brand-600 + nom "Toolbox" en font-hand. C'est l'1
 *     des 2 spots légitimes de la brand orange dans toute l'app.
 *  2. Badge worklist count = bg-brand-600. 2e spot légitime de la brand
 *     orange — c'est le signal "il y a du nouveau pour toi", signature
 *     visuelle reconnaissable depuis n'importe où dans l'app.
 *  3. Active state = bg-gray-950 text-white (sélection mono dark). Plus
 *     d'indigo-50/700.
 *  4. Sections consolidées pour admin (3 au lieu de 5) :
 *     Production (Calendrier + Templates + Mes générations) ·
 *     Clients (Clients + Comptes IG) · Système (Ressources + Users + Jobs).
 *  5. "Vue : Admin" → DropdownMenu primitive avec Eye icon. Plus de
 *     fuchsia ad hoc — quand override actif, l'effective role apparaît
 *     dans le label + badge info.
 *  6. Bouton collapse → ButtonIcon avec PanelLeftClose / PanelLeft de
 *     Lucide. Plus de "‹/›" ASCII.
 *  7. Impersonation banner garde amber (warning légitime, exception
 *     documentée) mais en density resserrée + ButtonIcon X pour quitter.
 *  8. User footer : Avatar initiale + nom truncate + role en text mono.
 *     SignOut en Button ghost (pas un text link discret).
 *  9. Density resserrée : items h-8 (Density Linear), eyebrow titles
 *     uppercase tracking-widest text-[10px] gray-500.
 * 10. Disabled "Bientôt" → Badge primitive variant="default" size sm.
 */

type NavItem = {
  href: string;
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  /** Si true, l'item n'est actif que sur correspondance exacte de l'URL. */
  exact?: boolean;
};

type NavSection = {
  title?: string;
  items: NavItem[];
};

function toolNavItem(key: keyof typeof TOOL_META, opts?: { disabled?: boolean }): NavItem {
  const { href, navLabel, Icon } = TOOL_META[key];
  return { href, label: navLabel, icon: <Icon size={14} />, ...opts };
}

/**
 * Phase 6.1 — Le badge worklist apparaissait seulement sur /home. Un admin
 * qui passe sa journée sur /calendar ne voyait jamais le signal. Étendu :
 * - Tout user → badge sur /home (worklist perso)
 * - ADMIN → badge aussi sur /calendar (page principale d'orchestration)
 */
function shouldShowWorklistBadge(href: string, canSeeAdmin: boolean): boolean {
  if (href === "/home") return true;
  if (canSeeAdmin && href === "/calendar") return true;
  return false;
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
  // Collapse state persisté en localStorage (Phase 6.1 — avant : useState
  // local perdu au hard refresh, friction quotidienne).
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem("toolbox_nav_collapsed");
    if (stored === "true") setCollapsed(true);
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("toolbox_nav_collapsed", String(collapsed));
  }, [collapsed]);
  const { count: worklistCount } = useWorklistCount();
  const { setViewAsRole } = useImpersonation();

  const canSeeAdmin = actualUser.role === "ADMIN";
  const navUser = isImpersonating || isRoleOverride ? effectiveUser : actualUser;
  const isAdminView = canSeeAdmin && !isImpersonating && !isRoleOverride;

  const userPerms = parsePermissions(navUser.permissions);
  const hasCaptions = userPerms.includes("captions");
  const hasCovers = userPerms.includes("covers");
  const hasTranscription = userPerms.includes("transcription");
  const hasDescription = userPerms.includes("description");
  const hasTemplates = userPerms.includes("templates");

  // ── Structure de nav consolidée ──────────────────────────────────────
  const navSections: NavSection[] = isAdminView
    ? [
        {
          items: [{ href: "/home", label: "Accueil", icon: <Home size={14} /> }],
        },
        {
          title: "Production",
          items: [
            { href: "/calendar", label: "Calendrier", icon: <CalendarDays size={14} /> },
            { href: "/templates", label: "Templates", icon: <LayoutTemplate size={14} /> },
            { href: "/listings", label: "Mes générations", icon: <List size={14} /> },
          ],
        },
        {
          title: "Clients",
          items: [
            { href: "/admin/clients", label: "Clients", icon: <Building2 size={14} /> },
            { href: "/admin/accounts", label: "Comptes Instagram", icon: <Instagram size={14} /> },
          ],
        },
        {
          title: "Système",
          items: [
            { href: "/admin/libraries", label: "Ressources", icon: <Library size={14} /> },
            { href: "/admin/users", label: "Utilisateurs", icon: <Users size={14} /> },
            { href: "/admin/jobs", label: "Jobs actifs", icon: <RotateCw size={14} /> },
          ],
        },
      ]
    : [
        {
          items: [{ href: "/home", label: "Accueil", icon: <Home size={14} /> }],
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
          items: [{ href: "/listings", label: "Mes générations", icon: <List size={14} /> }],
        },
      ];

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
        "flex flex-col h-full shrink-0 transition-[width] duration-200",
        // Surface Liquid Glass : gradient blanc + ring inset signature à droite
        // (pas de border-r solide). Backdrop-blur sur les surfaces glass
        // partout dans l'app, mais ici on garde solide pour lisibilité dense.
        "bg-gradient-to-b from-white/90 to-white/75 backdrop-blur-[16px] backdrop-saturate-150",
        "shadow-[inset_-1px_0_0_rgba(15,23,42,0.06),inset_0_1px_0_rgba(255,255,255,1)]",
        collapsed ? "w-14" : "w-56",
      ].join(" ")}
    >
      {/* ── Logo + collapse trigger ─────────────────────────────────── */}
      <div
        className={[
          "flex items-center shrink-0",
          "shadow-[inset_0_-1px_0_rgba(15,23,42,0.04)]",
          collapsed ? "justify-center px-2 py-3" : "justify-between px-3 py-3",
        ].join(" ")}
      >
        <Link
          href="/home"
          className={`inline-flex items-center gap-2 focus-ring rounded-md relative ${
            collapsed ? "" : "min-w-0"
          }`}
          title="Toolbox · Accueil"
        >
          <span className="h-7 w-7 rounded-md bg-brand-600 inline-flex items-center justify-center text-white text-[13px] font-bold shrink-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_1px_2px_rgba(224,66,16,0.18)]">
            T
          </span>
          {!collapsed && (
            <span className="font-hand text-xl leading-none text-gray-950 truncate">
              Toolbox
            </span>
          )}
          {/* Indicateur "Vue: X" en collapsed — sage dot signature si view-as actif */}
          {collapsed && isRoleOverride && (
            <Tooltip content={`Vue ${viewAsRoleLabel}`} side="bottom">
              <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-sage-500 shadow-[0_0_0_2px_rgba(255,255,255,1)]" aria-label={`Vue ${viewAsRoleLabel}`} />
            </Tooltip>
          )}
        </Link>
        {!collapsed && (
          <ButtonIcon
            icon={PanelLeftClose}
            label="Réduire la navigation"
            onClick={() => setCollapsed(true)}
            size="sm"
          />
        )}
      </div>
      {collapsed && (
        <div className="flex justify-center py-2 shadow-[inset_0_-1px_0_rgba(15,23,42,0.04)]">
          <ButtonIcon
            icon={PanelLeft}
            label="Ouvrir la navigation"
            onClick={() => setCollapsed(false)}
            size="sm"
          />
        </div>
      )}

      {/* ── View As (admin uniquement, pas en impersonation, expanded) ── */}
      {canSeeAdmin && !isImpersonating && !collapsed && (
        <div className="px-3 py-2 shadow-[inset_0_-1px_0_rgba(15,23,42,0.04)]">
          <DropdownMenu
            trigger={
              <button
                type="button"
                className={[
                  "w-full inline-flex items-center justify-between gap-2 h-8 px-2.5 rounded-md text-[12px] text-left transition-all focus-ring",
                  isRoleOverride
                    ? "bg-sage-50/65 backdrop-blur-[8px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(111,162,128,0.32)]"
                    : "bg-white/65 backdrop-blur-[8px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.1)] hover:bg-white/85 hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.16)]",
                ].join(" ")}
              >
                <span className="inline-flex items-center gap-1.5 min-w-0">
                  <Eye size={13} className={`shrink-0 ${isRoleOverride ? "text-sage-700" : "text-gray-500"}`} />
                  <span className={`truncate font-medium ${isRoleOverride ? "text-sage-700" : "text-gray-950"}`}>
                    Vue : {viewAsRoleLabel}
                  </span>
                </span>
              </button>
            }
            items={[
              { label: "Admin (par défaut)", onClick: () => void setViewAsRole(null) },
              { label: "Vue Vidéaste",       onClick: () => void setViewAsRole("VIDEASTE") },
              { label: "Vue Monteur",        onClick: () => void setViewAsRole("MONTEUR") },
              { label: "Vue CM",             onClick: () => void setViewAsRole("CM") },
            ]}
          />
        </div>
      )}

      {/* ── Navigation principale ──────────────────────────────────── */}
      <nav className={`flex-1 min-h-0 overflow-y-auto ${collapsed ? "px-1.5 py-3" : "px-2.5 py-3"} [scrollbar-width:thin]`}>
        {navSections.map(({ title, items }, index) => {
          if (items.length === 0) return null;
          return (
            <div
              key={title ?? `section-${index}`}
              className={
                index === 0
                  ? ""
                  : collapsed
                    ? "mt-3 pt-3 shadow-[inset_0_1px_0_rgba(15,23,42,0.04)]"
                    : "mt-4 pt-3 shadow-[inset_0_1px_0_rgba(15,23,42,0.04)]"
              }
            >
              {title && !collapsed && (
                <p className="px-2 pb-1.5 text-[10px] font-medium uppercase tracking-widest text-gray-500">
                  {title}
                </p>
              )}
              <div className="space-y-0.5">
                {items.map((item) => (
                  <NavItemLink
                    key={item.href}
                    item={item}
                    pathname={pathname ?? ""}
                    collapsed={collapsed}
                    worklistCount={shouldShowWorklistBadge(item.href, canSeeAdmin) ? worklistCount : 0}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </nav>

      {/* ── ⌘K command palette discoverability (admin uniquement) ────── */}
      {canSeeAdmin && !collapsed && (
        <div className="px-3 py-2 shadow-[inset_0_1px_0_rgba(15,23,42,0.04)]">
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event("admin:open-palette"))}
            className="w-full inline-flex items-center justify-between gap-2 h-7 px-2.5 rounded-md text-[11px] text-gray-500 hover:text-gray-950 hover:bg-white/60 hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08)] backdrop-blur-[6px] transition-all focus-ring"
          >
            <span className="inline-flex items-center gap-1.5">
              <Search size={11} />
              Rechercher
            </span>
            <Kbd size="sm">⌘K</Kbd>
          </button>
        </div>
      )}

      {/* ── User footer ─────────────────────────────────────────────── */}
      <div className={`shadow-[inset_0_1px_0_rgba(15,23,42,0.04)] ${collapsed ? "p-2" : "p-3"}`}>
        {collapsed ? (
          <div className="flex flex-col items-center gap-2">
            <Avatar
              name={navUser.name ?? navUser.email ?? "?"}
              size="sm"
              status={isImpersonating ? "away" : undefined}
            />
            <ButtonIcon
              icon={LogOut}
              label="Se déconnecter"
              size="sm"
              onClick={() => signOut({ callbackUrl: "/login" })}
            />
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Avatar
                name={navUser.name ?? navUser.email ?? "?"}
                size="sm"
                status={isImpersonating ? "away" : undefined}
              />
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-medium text-gray-950 truncate leading-tight">
                  {navUser.name ?? navUser.email}
                </p>
                <p className="text-[10px] uppercase tracking-widest text-gray-500 mt-0.5">
                  {isImpersonating
                    ? `${navUser.role ?? "User"} · via admin`
                    : (navUser.role ?? "Utilisateur")}
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              icon={LogOut}
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="w-full justify-center"
            >
              Se déconnecter
            </Button>
          </div>
        )}
      </div>
    </aside>
  );
}

// ─── Sub components ────────────────────────────────────────────────────

function NavItemLink({
  item,
  pathname,
  collapsed,
  worklistCount,
}: {
  item: NavItem;
  pathname: string;
  collapsed: boolean;
  worklistCount: number;
}) {
  const active =
    !item.disabled &&
    (pathname === item.href || (!item.exact && pathname.startsWith(`${item.href}/`)));
  const showBadge = worklistCount > 0;

  if (item.disabled) {
    return (
      <span
        title={item.label}
        className={`flex items-center gap-2 h-8 rounded-md text-[13px] cursor-not-allowed select-none text-gray-300 ${
          collapsed ? "justify-center px-0" : "px-2"
        }`}
      >
        <span className="shrink-0 flex items-center">{item.icon}</span>
        {!collapsed && (
          <span className="flex-1 flex items-center justify-between">
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
        "flex items-center gap-2 h-8 rounded-md text-[13px] transition-all focus-ring",
        active
          ? "bg-sky-50/65 backdrop-blur-[8px] text-sky-700 font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(77,150,191,0.32)]"
          : "text-gray-700 hover:bg-white/60 hover:backdrop-blur-[6px] hover:text-gray-950 hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)]",
        collapsed ? "justify-center px-0" : "px-2",
      ].join(" ")}
    >
      <span className="shrink-0 flex items-center relative">
        {item.icon}
        {showBadge && collapsed && (
          <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-brand-600 shadow-[0_0_0_2px_rgba(255,255,255,1)]" />
        )}
      </span>
      {!collapsed && (
        <span className="flex-1 flex items-center justify-between">
          <span className="truncate">{item.label}</span>
          {showBadge && (
            <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-brand-600 text-white text-[10px] font-semibold leading-none px-1">
              {worklistCount > 99 ? "99+" : worklistCount}
            </span>
          )}
        </span>
      )}
    </Link>
  );
}

// UserAvatar inline supprimé — Phase 6.1 utilise Avatar primitive (Phase 3 Lot 2).
