/**
 * Source de vérité unique du mode de rotation d'une `MediaLibrary`.
 *
 * Historique du piège que ce module supprime : jusqu'au 12/08/2026, la colonne
 * `rotationMode` était purement décorative — le resolver ne lisait que `"none"`,
 * et c'est `setSequence.length > 0` qui basculait en « Ordre fixe ». Le mode
 * était donc porté par la DONNÉE de config, si bien que changer de mode
 * imposait de muter la donnée, et muter la donnée changeait le mode. Combiné au
 * fait que la route PATCH jetait silencieusement `setSequence` (cf.
 * `@/lib/apiInput`), une bibliothèque affichée « Auto » continuait de tourner en
 * ordre fixe sur d'anciens setTags — et les assets uploadés depuis, absents de
 * la séquence, n'étaient jamais servis.
 *
 * Nouvelle sémantique : `rotationMode` décide, `setSequence` n'est plus que la
 * config du mode `override` (conservée, jamais effacée, pour qu'un aller-retour
 * auto → override retrouve l'ordre saisi).
 *
 * Aligné sur `DataLibrary.rotationMode` (`schema.prisma`), qui a toujours eu
 * cette sémantique.
 */

export type RotationMode = "auto" | "override" | "none";

export type RotationModeSource = {
  /** Colonne `MediaLibrary.rotationMode`. `null` = legacy, avant matérialisation. */
  rotationMode: string | null;
  /** Colonne `MediaLibrary.setSequence` (JSON `string[]`), ou le tableau déjà parsé. */
  setSequence: string | string[] | null | undefined;
};

export type ResolvedRotation = {
  mode: RotationMode;
  /** Séquence parsée, vidée de ses entrées falsy. Pertinente uniquement si `mode === "override"`. */
  sequence: string[];
};

/** Parse une colonne `setSequence` (JSON `string[]`) de façon défensive. */
export function parseSetSequence(raw: string | string[] | null | undefined): string[] {
  if (Array.isArray(raw)) return raw.filter((s): s is string => typeof s === "string" && !!s);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string" && !!s) : [];
  } catch {
    return [];
  }
}

/**
 * Résout le mode de rotation effectif d'une bibliothèque.
 *
 * | `rotationMode` | `setSequence` | → mode      |
 * |----------------|---------------|-------------|
 * | `"none"`       | *             | `none`      |
 * | `"override"`   | non vide      | `override`  |
 * | `"override"`   | vide          | `auto` (+warn) — sinon la bibliothèque ne servirait plus rien |
 * | `"auto"`       | *             | `auto` (séquence ignorée, pas effacée) |
 * | `null`         | non vide      | `override` (back-compat legacy) |
 * | `null`         | vide          | `auto`      |
 *
 * @param warnContext Si fourni, journalise les incohérences (appelants serveur).
 *                    Omis côté client pour ne pas polluer la console à chaque rendu.
 */
export function resolveRotationMode(
  lib: RotationModeSource,
  warnContext?: string,
): ResolvedRotation {
  const sequence = parseSetSequence(lib.setSequence);

  if (lib.rotationMode === "none") return { mode: "none", sequence };

  if (lib.rotationMode === "override") {
    if (sequence.length > 0) return { mode: "override", sequence };
    if (warnContext) {
      console.warn(
        `[${warnContext}] rotationMode="override" mais setSequence vide — repli sur le mode auto.`,
      );
    }
    return { mode: "auto", sequence };
  }

  if (lib.rotationMode === "auto") return { mode: "auto", sequence };

  // rotationMode null (legacy, avant backfill) : on rejoue l'ancienne règle.
  return { mode: sequence.length > 0 ? "override" : "auto", sequence };
}

/**
 * Mode **déclaré** — l'intention de l'utilisateur, pour les UI d'édition.
 *
 * Diffère de `resolveRotationMode` sur un seul cas : `"override"` avec une
 * séquence vide reste `"override"` ici, sinon l'utilisateur ne pourrait plus
 * remplir sa séquence (le sélecteur retomberait sur « Auto » à chaque
 * ouverture). Les surfaces qui exposent ce mode doivent signaler l'écart —
 * cf. la bannière du drawer médiathèque.
 */
export function declaredRotationMode(lib: RotationModeSource): RotationMode {
  if (lib.rotationMode === "none") return "none";
  if (lib.rotationMode === "override") return "override";
  if (lib.rotationMode === "auto") return "auto";
  return parseSetSequence(lib.setSequence).length > 0 ? "override" : "auto";
}
