/**
 * Commandes navigation — disponibles pour TOUS les rôles via ⌘K.
 *
 * Chacune simple : ouvrir une page. Filtrage par rôle via canRun :
 * - "Aller au calendrier" : pour tous
 * - "Aller aux recettes" : admin only (route /admin/patterns)
 * - "Aller à l'atelier" : si l'user a au moins une perm outils
 * - etc.
 */

import {
  CalendarDays,
  Home,
  Sparkles,
  Instagram,
  Library,
  Users,
  Building2,
  Clapperboard,
  Hammer,
  History,
  RotateCw,
} from "lucide-react";
import type { Command } from "./registry";
import { parsePermissions } from "@/lib/permissions/parsePermissions";

function hasAnyToolPerm(permsRaw: string): boolean {
  const perms = parsePermissions(permsRaw);
  return (
    perms.includes("captions") ||
    perms.includes("description") ||
    perms.includes("transcription") ||
    perms.includes("templates")
  );
}

export const NAVIGATION_COMMANDS: Command[] = [
  // ── Pour tous les rôles ─────────────────────────────────────────────
  {
    id: "nav.home",
    label: "Aller à l'accueil",
    icon: Home,
    group: "nav",
    canRun: () => true,
    keywords: ["home", "accueil", "dashboard", "inbox"],
    run: (ctx) => ctx.push("/home"),
  },
  {
    id: "nav.calendar",
    label: "Aller au calendrier",
    icon: CalendarDays,
    group: "nav",
    canRun: () => true,
    keywords: ["calendar", "calendrier", "planning", "semaine"],
    run: (ctx) => ctx.push("/calendar"),
  },
  {
    id: "nav.listings",
    label: "Mes générations",
    icon: History,
    group: "nav",
    canRun: () => true,
    keywords: ["listings", "générations", "historique", "rendus"],
    run: (ctx) => ctx.push("/listings"),
  },

  // ── Production (si perm) ────────────────────────────────────────────
  {
    id: "nav.studio",
    label: "Studio (templates)",
    icon: Clapperboard,
    group: "tools",
    canRun: (u) =>
      u.isAdminReal || parsePermissions(u.permissions).includes("templates"),
    keywords: ["studio", "templates", "création", "video"],
    run: (ctx) => ctx.push("/templates"),
  },
  {
    id: "nav.outils",
    label: "Atelier (outils)",
    icon: Hammer,
    group: "tools",
    canRun: (u) => u.isAdminReal || hasAnyToolPerm(u.permissions),
    keywords: ["atelier", "outils", "tools", "captions", "descriptions"],
    run: (ctx) => ctx.push("/outils"),
  },

  // ── Admin only ──────────────────────────────────────────────────────
  {
    id: "nav.patterns",
    label: "Recettes",
    description: "Catalogue des recettes éditoriales",
    icon: Sparkles,
    group: "admin",
    canRun: (u) => u.isAdminReal,
    keywords: ["recettes", "patterns", "templates", "workflows"],
    run: (ctx) => ctx.push("/admin/patterns"),
  },
  {
    id: "nav.accounts",
    label: "Comptes Instagram",
    icon: Instagram,
    group: "admin",
    canRun: (u) => u.isAdminReal,
    keywords: ["accounts", "comptes", "instagram", "ig"],
    run: (ctx) => ctx.push("/admin/accounts"),
  },
  {
    id: "nav.libraries",
    label: "Médiathèque",
    icon: Library,
    group: "admin",
    canRun: (u) => u.isAdminReal,
    keywords: ["medias", "library", "bibliothèque", "vidéos", "musiques"],
    run: (ctx) => ctx.push("/admin/libraries"),
  },
  {
    id: "nav.users",
    label: "Utilisateurs",
    icon: Users,
    group: "config",
    canRun: (u) => u.isAdminReal,
    keywords: ["users", "utilisateurs", "team", "équipe"],
    run: (ctx) => ctx.push("/admin/users"),
  },
  {
    id: "nav.clients",
    label: "Clients",
    icon: Building2,
    group: "config",
    canRun: (u) => u.isAdminReal,
    keywords: ["clients", "marques", "agences"],
    run: (ctx) => ctx.push("/admin/clients"),
  },
  {
    id: "nav.jobs",
    label: "Jobs actifs",
    description: "Monitoring opérationnel",
    icon: RotateCw,
    group: "config",
    canRun: (u) => u.isAdminReal,
    keywords: ["jobs", "ops", "monitoring", "background"],
    run: (ctx) => ctx.push("/admin/jobs"),
  },
];
