/**
 * Le moteur de chaîne d'étapes, sans rien qui parle de vidéo.
 *
 * Extrait de `lib/publications/steps.ts`, qui mêlait deux choses : la MÉCANIQUE
 * (une étape ne peut pas être plus avancée que ce qui la précède ; la prochaine
 * action est la première étape réellement faisable) et la DÉFINITION du pipeline
 * de publication. La fiche de tournage a besoin de la première sans la seconde.
 *
 * Ce module ne filtre PAS par rôle : chaque étape transporte ses `roles`, et
 * c'est la surface d'affichage qui décide (cf. `ProductionChain`).
 */

import type { UserRole } from "@/types/roles";

export type StepStatus =
  | "todo"
  | "waiting" // étape future, en attente d'une étape amont non terminée (visuel todo, label "En attente")
  | "queued"
  | "processing"
  | "done"
  | "failed"
  | "blocked";

export interface ChainStep<K extends string> {
  key: K;
  /** Libellé affiché dans l'UI (FR). */
  label: string;
  /** Faux si l'étape n'est pas applicable à cet objet. */
  visible: boolean;
  status: StepStatus;
  /**
   * true uniquement pour la première étape visible dont
   * status ∈ ["todo", "failed"] — indique la prochaine action à mener.
   */
  nextAction: boolean;
  /** Rôles intéressés par cette étape (utilisé à l'affichage pour filtrer). */
  roles: UserRole[];
  /**
   * Ce qu'il y a à FAIRE, à l'infinitif — pour le bandeau « à toi ». Le `label`
   * nomme l'étape (« Tournage »), il ne dit pas quoi faire.
   */
  action?: string;
  /**
   * Description à afficher à la place du libellé de statut générique. Sert à
   * dire « 1 sur 2 publiées » plutôt que « Action attendue », quand le statut
   * seul ne raconte pas ce qui se passe.
   */
  hint?: string;
  /**
   * Quand `status === "waiting"`, libellé de la première étape amont visible
   * non terminée. Permet d'afficher « En attente de : Montage » plutôt qu'un
   * « en attente de l'étape précédente » générique, donc trompeur.
   */
  waitingFor?: string;
}

/** Une étape avant passage au moteur : `nextAction` et `waitingFor` sont son travail. */
export type RawStep<K extends string> = Omit<ChainStep<K>, "nextAction" | "waitingFor">;

export interface ResolveOptions<K extends string> {
  /**
   * Étapes dont le statut est piloté par un état GLOBAL de l'objet, et non par
   * ce qui les précède : on ne les déclasse jamais par la règle d'amont, sauf
   * pour le cas « todo → waiting ».
   */
  statusDriven?: readonly K[];
}

/** Seul `done` compte comme réellement terminé pour débloquer la suite. */
const TERMINAL: ReadonlySet<StepStatus> = new Set<StepStatus>(["done"]);

/** Statuts qui n'ont pas besoin d'arbitrage amont. */
const NEEDS_UPSTREAM_CHECK: ReadonlySet<StepStatus> = new Set<StepStatus>([
  "todo",
  "done",
  "processing",
  "queued",
]);

/**
 * Applique la cohérence d'amont, puis désigne la prochaine action.
 *
 * Règle stricte : une étape ne peut pas être plus « avancée » que les étapes
 * visibles qui la précèdent. Cela couvre deux cas :
 *
 *   a) `todo` → `waiting` si une étape amont n'est pas terminée ;
 *   b) `done` → `waiting` idem — le cas du résultat orphelin, produit par une
 *      étape amont qui a depuis été défaite. Sans cette règle, la chaîne
 *      affichait « Sous-titres : Fait » au-dessus de « Montage : action
 *      attendue », ce qui ne veut rien dire.
 *
 * Pour distinguer un jour le « done orphelin » (badge « pré-livré » ou autre),
 * il suffira d'ajouter un statut : ici on privilégie la lisibilité de la chaîne.
 */
export function resolveChain<K extends string>(
  rawSteps: RawStep<K>[],
  { statusDriven = [] }: ResolveOptions<K> = {},
): ChainStep<K>[] {
  const statusDrivenSet = new Set<K>(statusDriven);
  const visibleSteps = rawSteps.filter((s) => s.visible);

  const adjusted = rawSteps.map((step) => {
    if (statusDrivenSet.has(step.key) && step.status !== "todo") return step;
    if (!NEEDS_UPSTREAM_CHECK.has(step.status)) return step;

    const idx = visibleSteps.findIndex((s) => s.key === step.key);
    if (idx <= 0) return step;

    const blocker = visibleSteps.slice(0, idx).find((s) => !TERMINAL.has(s.status));
    return blocker
      ? { ...step, status: "waiting" as StepStatus, waitingFor: blocker.label }
      : step;
  });

  // La prochaine action est la première étape réellement faisable MAINTENANT
  // (todo ou failed). Les étapes en `waiting` sont futures, pas actives.
  let claimed = false;
  return adjusted.map((step) => {
    const actionable =
      step.visible && (step.status === "todo" || step.status === "failed") && !claimed;
    if (actionable) claimed = true;
    return { ...step, nextAction: actionable };
  });
}
