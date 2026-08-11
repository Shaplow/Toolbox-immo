/**
 * promptKind — usage métier d'un prompt IA et de la génération qui en découle.
 *
 * `DescriptionPrompt` et `DescriptionJob` servent désormais deux usages distincts :
 * la légende Instagram d'une publication, et le brief de montage destiné au
 * monteur. Sans ce discriminant, tous les prompts actifs remontent dans tous les
 * pickers — un prompt de brief polluerait l'outil descriptions et réciproquement.
 *
 * Choix assumé : un champ `kind` sur les modèles existants plutôt qu'un troisième
 * modèle de prompt. Le repo a déjà `DescriptionPrompt` et `CaptionPrompt` ; en
 * ajouter un `BriefPrompt` aurait multiplié les CRUD, les routes et les panneaux
 * d'admin pour la même forme de donnée (`name` + `prompt`).
 *
 * Stringly-typed comme `recipeKind`, pour rester cohérent avec l'existant et
 * éviter une migration d'enum PostgreSQL à chaque nouvel usage.
 */

export type PromptKind = "description" | "brief";

export const PROMPT_KINDS: readonly PromptKind[] = ["description", "brief"] as const;

const PROMPT_KIND_SET = new Set<string>(PROMPT_KINDS);

export function isPromptKind(value: unknown): value is PromptKind {
  return typeof value === "string" && PROMPT_KIND_SET.has(value);
}

/**
 * Normalise avec repli sur `description`.
 *
 * Le repli n'est pas cosmétique : c'est ce qui garantit que les prompts et jobs
 * créés avant la migration `20260811120000_add_prompt_and_job_kind` restent
 * visibles dans l'outil descriptions.
 */
export function normalizePromptKind(value: unknown): PromptKind {
  return isPromptKind(value) ? value : "description";
}

/** Libellés FR, pour l'admin des prompts. */
export const PROMPT_KIND_LABELS: Record<PromptKind, string> = {
  description: "Description / légende",
  brief: "Brief monteur",
};
