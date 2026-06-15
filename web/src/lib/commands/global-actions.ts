/**
 * Commandes globales "sans recherche" — actions rapides ⌘K accessibles
 * sans avoir à taper de query.
 *
 * Exemples : "Nouvelle publication", "Aller à demain", "Activer / désactiver Avancé".
 *
 * Pour les commandes d'action contextuelles (ex. "Valider la dernière version
 * de @lola"), voir slot-actions.ts (à venir Phase 4 quand getInboxItems sera
 * disponible).
 */

import { Plus, CalendarPlus, Settings2 } from "lucide-react";
import type { Command } from "./registry";

export const GLOBAL_COMMANDS: Command[] = [
  {
    id: "global.new-slot",
    label: "Nouvelle publication",
    description: "Créer un nouveau créneau dans le calendrier",
    icon: Plus,
    group: "create",
    canRun: (u) => u.isAdminReal,
    keywords: ["nouveau", "slot", "publication", "créer"],
    shortcut: ["⌘", "N"],
    run: (ctx) => {
      // L'ouverture de la modal AddSlot se fait via event custom écouté par
      // CalendarView. Si on n'est pas sur /calendar, on y va d'abord.
      ctx.push("/calendar?new=1");
    },
  },
  {
    id: "global.calendar-tomorrow",
    label: "Aller à demain",
    description: "Calendrier centré sur demain",
    icon: CalendarPlus,
    group: "nav",
    canRun: () => true,
    keywords: ["demain", "tomorrow", "calendrier"],
    run: (ctx) => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const monday = new Date(tomorrow);
      const day = monday.getDay();
      // Aligner sur le lundi de la semaine de demain (la grille est hebdo).
      const diff = day === 0 ? -6 : 1 - day;
      monday.setDate(monday.getDate() + diff);
      const iso = monday.toISOString().slice(0, 10);
      ctx.push(`/calendar?week=${iso}`);
    },
  },
  {
    id: "global.bank-view",
    label: "Vue banque",
    description: "Contenus produits en attente de programmation",
    icon: Settings2,
    group: "nav",
    canRun: (u) => u.isAdminReal,
    keywords: ["banque", "bank", "programmer", "prêts"],
    run: (ctx) => ctx.push("/calendar?view=bank"),
  },
];
