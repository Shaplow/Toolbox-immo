"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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
  Eye,
  ChevronLeft,
  ChevronRight,
  Search,
  Hammer,
  History,
  MoreHorizontal,
} from "lucide-react";
import type { AppUserIdentity } from "@/lib/userContext";
import { parsePermissions } from "@/lib/permissions/parsePermissions";
import { useWorklistCount } from "@/hooks/useWorklistCount";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { DropdownMenu } from "@/components/ui/DropdownMenu";

/**
 * AppNav — navigation latérale principale.
 *
 * Décisions UX (Phase 3 ui-boost → Liquid Glass v2 → minimalist 2026-05-30) :
 *  1. Pas de logo carré. Wordmark "Team PDC" seul en font-hand (le
 *     branding tient en typo, pas en mark). Cliquable → /home.
 *  2. Sections consolidées pour admin (Planification / Production /
 *     Configuration) + items top-level Accueil & Mes générations.
 *  3. Active state = glass blanc subtle + barre graphite gauche
 *     (shadow inset). Plus de fill mono dark.
 *  4. "Vue : Admin" → DropdownMenu dans le footer profil (Eye icon).
 *     Quand override actif, dot peach pulse sur l'avatar et libellé
 *     "Vue X" sous le wordmark.
 *  5. Bouton collapse = chevron minimal (ChevronLeft/Right) en
 *     text-gray-300 hover:text-gray-700. Pas de box ni shadow.
 *  6. Impersonation banner garde amber (warning légitime, exception
 *     documentée) en density resserrée.
 *  7. User footer = card glass rounded-2xl, avatar md (32px),
 *     nom + role pill. DropdownMenu = se déconnecter + Vue X + Jobs.
 *  8. Density resserrée : items h-9, eyebrow titles uppercase
 *     tracking-[0.18em] text-[9px] gray-400.
 *  9. Disabled "Bientôt" → Badge primitive variant="default" size sm.
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
  const router = useRouter();
  // Collapse state persisté en localStorage (Phase 6.1 — avant : useState
  // local perdu au hard refresh, friction quotidienne).
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

  // Hub /outils accessible si l'user a au moins une perm standalone.
  // (ADMIN bypass → toujours true via canAdminBypass mais la nav non-ADMIN
  // est filtrée séparément ; pour ADMIN, le lien Outils est dans Configuration.)
  const hasAnyToolPerm =
    hasTemplates || hasTranscription || hasCaptions || hasDescription || hasCovers;

  // Détection EXTERNAL_GENERATOR — accède à Templates direct (pas via hub
  // qui filtrerait) et à son historique Mes générations.
  const isExternalGenerator = navUser.role === "EXTERNAL_GENERATOR";

  // ── Structure de nav consolidée ──────────────────────────────────────
  let navSections: NavSection[];

  if (isAdminView) {
    // ADMIN : structure 3 sections métier + 2 items top-level.
    // - Top-level : Accueil + Mes générations (vues persos toujours visibles)
    // - PLANIFICATION : vues planning (Calendrier + Comptes IG + Médiathèque = ressources planifiées)
    // - PRODUCTION : surfaces de création (Studio = construction finale, Atelier = outils, historique perso)
    // - CONFIGURATION : config rare (Utilisateurs, Clients = setup ponctuel)
    // - Footer ⋯ : Jobs actifs (et autres tools superadmin futurs)
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
        ],
      },
      {
        title: "Production",
        // Studio = clap de cinéma (construction finale du rendu).
        // Atelier = marteau (outils de l'atelier — captions, transcription, etc.).
        // Mes générations = historique perso (icône History).
        items: [
          { href: "/templates", label: "Studio", icon: <Clapperboard size={14} /> },
          { href: "/outils", label: "Atelier", icon: <Hammer size={14} /> },
          { href: "/listings", label: "Mes générations", icon: <History size={14} /> },
        ],
      },
      {
        title: "Configuration",
        items: [
          { href: "/admin/users", label: "Utilisateurs", icon: <Users size={14} /> },
          { href: "/admin/clients", label: "Clients", icon: <Building2 size={14} /> },
        ],
      },
    ];
  } else if (isExternalGenerator) {
    // EXTERNAL_GENERATOR : Accueil + Studio direct (use case = générer)
    // + Mes générations (récupérer ses propres outputs).
    navSections = [
      {
        items: [
          { href: "/home", label: "Accueil", icon: <Home size={14} /> },
          { href: "/templates", label: "Studio", icon: <Clapperboard size={14} /> },
          { href: "/listings", label: "Mes générations", icon: <History size={14} /> },
        ],
      },
    ];
  } else {
    // MONTEUR / CM / VIDEASTE : Accueil + Atelier (hub si au moins 1 perm)
    // + Mes générations (leur historique propre).
    navSections = [
      {
        items: [
          { href: "/home", label: "Accueil", icon: <Home size={14} /> },
          ...(hasAnyToolPerm
            ? [{ href: "/outils", label: "Atelier", icon: <Hammer size={14} /> }]
            : []),
          { href: "/listings", label: "Mes générations", icon: <History size={14} /> },
        ],
      },
    ];
  }

  // Wordmark : "Team PDC" partout sauf pour un client externe — il voit son
  // propre nom (son espace, pas une marque d'agence). Fallback "Mon espace"
  // si le name est vide (cas dégénéré, ne devrait pas arriver en prod).
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
        // Nav flottante — AUCUN bg, AUCUN shadow, AUCUN border. Les items
        // flottent sur le fond gris-100/60 de l'app shell. Seul le footer
        // user card a une matière glass (signature). Référence : reference
        // screenshot Mathis.
        "relative flex flex-col h-screen shrink-0 transition-[width] duration-200",
        collapsed ? "w-14" : "w-64",
      ].join(" ")}
    >
      {/* ── Header wordmark — aligné au top, même hauteur que le top du
            wrapper pastel à droite (mt-8 = pt-8 ici). Bouton collapse =
            chevron simple discret (text-gray-300 hover:text-gray-700). */}
      <div
        className={[
          "shrink-0 pt-8",
          collapsed ? "px-2 pb-4" : "pl-10 pr-8 pb-4",
        ].join(" ")}
      >
        {collapsed ? (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              className="inline-flex items-center justify-center h-7 w-7 rounded-md text-gray-300 hover:text-gray-700 hover:bg-white/60 transition-all focus-ring"
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
              className="inline-flex items-center px-2 py-1.5 -mx-2 -my-1.5 rounded-xl focus-ring transition-all hover:bg-white/50 hover:backdrop-blur-[8px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)] min-w-0"
              title={`${wordmark} · Accueil`}
            >
              <span className="min-w-0 flex-1">
                <span className="block font-hand text-[22px] leading-none text-gray-950 truncate">
                  {wordmark}
                </span>
                {isRoleOverride && (
                  <span className="mt-1 inline-flex items-center gap-1 text-[9px] uppercase tracking-widest text-peach-700 font-semibold">
                    <span className="h-1.5 w-1.5 rounded-full bg-peach-500 shadow-[0_0_6px_rgba(245,158,107,0.55)] animate-pulse" />
                    Vue {viewAsRoleLabel}
                  </span>
                )}
              </span>
            </Link>
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              className="shrink-0 inline-flex items-center justify-center h-7 w-7 rounded-md text-gray-300 hover:text-gray-700 hover:bg-white/60 transition-all focus-ring"
              aria-label="Réduire la navigation"
              title="Réduire"
            >
              <ChevronLeft size={14} strokeWidth={2} />
            </button>
          </div>
        )}
      </div>

      {/* Vue-As dropdown — Phase 6.1 : déplacé dans le user footer (en bas
          de la nav, à côté du profil). Plus naturel comme contrôle admin
          attaché au profil, libère l'espace haut. */}

      {/* ── Navigation principale ────────────────────────────────────
          flex flex-col + wrapper interne `my-auto` : le menu est centré
          verticalement entre le logo et le footer profil quand il rentre
          dans la viewport. Si le contenu dépasse, my-auto se collapse à 0
          et le scroll vertical natif prend le relais (overflow-y-auto). */}
      <nav className={`flex-1 min-h-0 overflow-y-auto flex flex-col ${collapsed ? "px-2 py-3" : "px-8 py-3"} [scrollbar-width:thin]`}>
        <div className="my-auto">
          {navSections.map(({ title, items }, index) => {
            if (items.length === 0) return null;
            return (
              <div
                key={title ?? `section-${index}`}
                className={
                  index === 0
                    ? ""
                    : collapsed
                      ? "mt-4"
                      : "mt-5"
                }
              >
                {title && !collapsed && (
                  <p className="pr-2 pb-1.5 text-right text-[9px] font-semibold uppercase tracking-[0.18em] text-gray-400">
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
                      // Notifs/badges désactivés temporairement (à réactiver
                      // plus tard avec inbox / notifications system propre).
                      worklistCount={0}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </nav>

      {/* ── User footer = UNE seule card glass flottante. Aligné en bas
            et poussé au plus à droite possible (pl libre, pr serré). */}
      <div className={collapsed ? "pt-2 pb-8 pl-2 pr-1 flex justify-end" : "pl-8 pr-2 pt-4 pb-8 flex justify-end"}>
        {(() => {
          type MenuItem =
            | { label: string; icon?: typeof Hammer; onClick: () => void; destructive?: boolean; kbd?: string }
            | "separator";
          const menuItems: MenuItem[] = [];

          // Rechercher (admin only — palette dispo)
          if (canSeeAdmin) {
            menuItems.push({
              label: "Rechercher",
              icon: Search,
              kbd: "⌘K",
              onClick: () => window.dispatchEvent(new Event("admin:open-palette")),
            });
          }

          // Vue admin (admin only)
          if (canSeeAdmin && !isImpersonating) {
            if (menuItems.length > 0) menuItems.push("separator");
            menuItems.push({
              label: isRoleOverride ? "Vue : Admin (revenir)" : "Vue : Admin",
              icon: Eye,
              onClick: () => void setViewAsRole(null),
            });
            menuItems.push({ label: "Vue Vidéaste", onClick: () => void setViewAsRole("VIDEASTE") });
            menuItems.push({ label: "Vue Monteur",  onClick: () => void setViewAsRole("MONTEUR") });
            menuItems.push({ label: "Vue CM",       onClick: () => void setViewAsRole("CM") });
          }

          // Jobs actifs (admin only)
          if (canSeeAdmin) {
            if (menuItems.length > 0) menuItems.push("separator");
            menuItems.push({
              label: "Jobs actifs",
              icon: RotateCw,
              onClick: () => router.push("/admin/jobs"),
            });
          }

          // Se déconnecter (toujours)
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
                      <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-peach-500 shadow-[0_0_0_2px_rgba(255,255,255,1)]" />
                    )}
                  </button>
                }
                items={menuItems}
              />
            );
          }

          // Role en mini pill capitalisé (Admin / Vidéaste / Monteur / CM).
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
                  className="inline-flex items-center gap-3 p-3 rounded-2xl bg-gradient-to-b from-white/85 to-white/65 backdrop-blur-[8px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08),0_2px_8px_-4px_rgba(15,23,42,0.12)] hover:from-white/95 hover:to-white/75 hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.12),0_4px_12px_-4px_rgba(15,23,42,0.18)] hover:-translate-y-0.5 transition-all focus-ring text-left max-w-[220px]"
                >
                  <span className="relative">
                    <Avatar
                      name={navUser.name ?? navUser.email ?? "?"}
                      size="md"
                      status={isImpersonating ? "away" : undefined}
                      ring={isRoleOverride}
                    />
                    {/* Status dot pulse online — signature playground. */}
                    {!isImpersonating && !isRoleOverride && (
                      <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-sage-500 shadow-[0_0_0_2px_rgba(255,255,255,1),0_0_6px_rgba(111,162,128,0.55)] animate-pulse" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-gray-950 truncate leading-tight">
                      {navUser.name ?? navUser.email}
                    </p>
                    <p className="mt-0.5 inline-flex items-center gap-1.5 truncate">
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-sky-100/60 text-sky-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_0_1px_rgba(77,150,191,0.18)]">
                        {roleLabel}
                      </span>
                      {(isImpersonating || isRoleOverride) && (
                        <span className="text-[10px] text-gray-500 truncate">
                          {isImpersonating ? "via admin" : "vue"}
                        </span>
                      )}
                    </p>
                  </div>
                  <MoreHorizontal size={15} className="text-gray-500 shrink-0" />
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
          collapsed ? "justify-center px-0" : "justify-end px-2"
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
        "relative flex items-center gap-2.5 h-9 rounded-lg text-[13px] transition-all focus-ring",
        active
          // Active = glass blanc subtle, sans bord. Just light + spéculaire.
          ? "bg-gradient-to-b from-white/95 to-white/75 backdrop-blur-[10px] text-gray-950 font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,1),0_1px_2px_rgba(15,23,42,0.04)]"
          : "text-gray-700 hover:bg-white/70 hover:backdrop-blur-[8px] hover:text-gray-950 hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),0_1px_2px_rgba(15,23,42,0.04)]",
        collapsed ? "justify-center px-0" : "justify-end px-2.5",
      ].join(" ")}
    >
      <span className="shrink-0 flex items-center relative">
        {item.icon}
        {showBadge && collapsed && (
          <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-sky-500 shadow-[0_0_0_2px_rgba(255,255,255,1)]" />
        )}
      </span>
      {!collapsed && (
        <span className="inline-flex items-center gap-1.5 min-w-0">
          <span className="truncate">{item.label}</span>
          {showBadge && (
            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-gradient-to-b from-sky-500 to-sky-600 text-white text-[10px] font-semibold leading-none px-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.32),0_1px_2px_rgba(77,150,191,0.32)]">
              {worklistCount > 99 ? "99+" : worklistCount}
            </span>
          )}
        </span>
      )}
    </Link>
  );
}

// UserAvatar inline supprimé — Phase 6.1 utilise Avatar primitive (Phase 3 Lot 2).
