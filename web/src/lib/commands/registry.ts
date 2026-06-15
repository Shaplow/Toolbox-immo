/**
 * Registry typé pour la Command Palette V2 (⌘K).
 *
 * Une Command décrit une entrée actionable dans la palette :
 *  - `id` unique pour le tracking et le keying.
 *  - `label` court (affiché en gros).
 *  - `description?` ligne secondaire (contexte).
 *  - `group` pour grouper visuellement.
 *  - `canRun(user)` filtre côté client (le backend re-vérifie au call).
 *  - `keywords?` aide la recherche fuzzy (synonymes, alias).
 *  - `shortcut?` raccourci clavier affiché à droite (ex. ["⌘", "N"]).
 *  - `run(ctx)` action exécutée à l'Enter / click.
 *
 * Le pattern est volontairement simple : pas de DSL, pas de système de
 * sous-menus. Une commande = une action. Si besoin de paramètres, prévoir
 * un Modal qui s'ouvre derrière la palette (voir slot-actions pour exemples).
 */

import type { LucideIcon } from "lucide-react";

export type CommandUser = {
  id: string;
  role: string;
  permissions: string;
  /** True si l'utilisateur est ADMIN réel (pas en impersonation). */
  isAdminReal: boolean;
};

export type CommandRunCtx = {
  /** Navigation programmatique (next/router). */
  push: (href: string) => void;
  /** Replace au lieu de push (pas d'entrée history). */
  replace: (href: string) => void;
  /** Ferme la palette après run. Optionnel — la palette ferme par défaut. */
  closePalette: () => void;
};

export type CommandGroup =
  | "nav"
  | "action"
  | "create"
  | "admin"
  | "tools"
  | "config"
  | "search";

export interface Command {
  id: string;
  label: string;
  description?: string;
  icon?: LucideIcon;
  group: CommandGroup;
  canRun: (user: CommandUser) => boolean;
  keywords?: string[];
  shortcut?: string[];
  run: (ctx: CommandRunCtx) => void | Promise<void>;
}

export const GROUP_LABELS: Record<CommandGroup, string> = {
  nav: "Navigation",
  action: "Actions",
  create: "Créer",
  admin: "Admin",
  tools: "Outils",
  config: "Configuration",
  search: "Résultats",
};

/**
 * Helper : filtre les commandes selon les permissions de l'user.
 */
export function filterCommands(
  commands: Command[],
  user: CommandUser,
): Command[] {
  return commands.filter((c) => c.canRun(user));
}

/**
 * Helper : groupe les commandes par group, en respectant l'ordre du tableau
 * GROUP_ORDER.
 */
const GROUP_ORDER: CommandGroup[] = [
  "action",
  "create",
  "nav",
  "tools",
  "admin",
  "config",
  "search",
];

export function groupCommands(
  commands: Command[],
): Array<{ group: CommandGroup; items: Command[] }> {
  const map = new Map<CommandGroup, Command[]>();
  for (const cmd of commands) {
    const arr = map.get(cmd.group) ?? [];
    arr.push(cmd);
    map.set(cmd.group, arr);
  }
  return GROUP_ORDER.filter((g) => map.has(g)).map((g) => ({
    group: g,
    items: map.get(g)!,
  }));
}

/**
 * Helper : matching fuzzy léger sur label + keywords + description.
 * Pas une vraie recherche fuzzy (Fuse.js / cmdk pourraient le faire mieux),
 * mais suffit pour le scope navigation.
 *
 * Retourne un score : 0 = no match, >0 = matched. Plus haut = mieux.
 */
export function fuzzyScore(cmd: Command, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1; // empty query = all match
  const label = cmd.label.toLowerCase();
  if (label.startsWith(q)) return 100;
  if (label.includes(q)) return 50;
  for (const kw of cmd.keywords ?? []) {
    if (kw.toLowerCase().includes(q)) return 30;
  }
  if (cmd.description?.toLowerCase().includes(q)) return 10;
  return 0;
}
