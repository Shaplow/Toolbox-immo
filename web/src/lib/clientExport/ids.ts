/**
 * Références stables des fichiers d'un lien d'export.
 *
 *   média       `m.<assetId>.<accountId|c>`
 *   données     `d.<libraryId>.<accountId|c>`
 *   publication `p.<slotId>`
 *
 * Le navigateur du client renvoie ces refs à /api/export/[token]/urls pour
 * obtenir une URL signée : le format doit donc rester sans ambiguïté, et
 * `parseRef` refuse tout ce que ces constructeurs n'ont pas pu produire.
 * L'autorisation, elle, ne repose jamais sur le parsing : une ref n'est signée
 * que si elle figure dans le manifeste du lien (cf. services/clientExport).
 *
 * Pur : aucun import serveur (ce module est aussi chargé dans le navigateur).
 */

/**
 * Marque « Commun » (aucun compte) à la place d'un accountId. Un cuid fait 25
 * caractères : aucun compte réel ne peut s'appeler « c ».
 */
export const COMMON_ACCOUNT_REF = "c";

/**
 * Forme d'un id dans une ref : un cuid, mais aussi les ids posés à la main par
 * les seeds de test (« test-slot-1 », « etype_bien »). Jamais de point : c'est
 * le séparateur. Bornée pour que le coût d'un parsing reste constant quelle que
 * soit l'entrée envoyée par un visiteur anonyme.
 */
const REF_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** `m.` + id + `.` + id : au-delà, la ref ne peut pas être valide. */
const MAX_REF_LENGTH = 2 + 64 + 1 + 64;

// Les constructeurs ne valident rien : un id exotique produit une ref que
// `parseRef` refusera (le fichier sortira « introuvable »), plutôt qu'une
// exception au milieu du calcul d'un manifeste de plusieurs milliers de lignes.

export function mediaRef(assetId: string, accountId: string | null): string {
  return `m.${assetId}.${accountId ?? COMMON_ACCOUNT_REF}`;
}

export function dataRef(libraryId: string, accountId: string | null): string {
  return `d.${libraryId}.${accountId ?? COMMON_ACCOUNT_REF}`;
}

export function publicationRef(slotId: string): string {
  return `p.${slotId}`;
}

export type ParsedRef =
  | { kind: "media"; assetId: string; accountId: string | null }
  | { kind: "data"; libraryId: string; accountId: string | null }
  | { kind: "publication"; slotId: string };

/** Relit une ref ; null pour tout ce qui n'a pas exactement la forme d'une ref émise. */
export function parseRef(ref: string): ParsedRef | null {
  // Le corps d'une requête publique n'est pas typé à l'exécution.
  if (typeof ref !== "string" || ref.length > MAX_REF_LENGTH) return null;
  const parts = ref.split(".");

  if (parts[0] === "p") {
    return parts.length === 2 && REF_ID_PATTERN.test(parts[1]) ? { kind: "publication", slotId: parts[1] } : null;
  }

  if (parts[0] !== "m" && parts[0] !== "d") return null;
  if (parts.length !== 3) return null;
  const [kind, id, account] = parts;
  if (!REF_ID_PATTERN.test(id)) return null;

  let accountId: string | null;
  if (account === COMMON_ACCOUNT_REF) accountId = null;
  else if (REF_ID_PATTERN.test(account)) accountId = account;
  else return null;

  return kind === "m" ? { kind: "media", assetId: id, accountId } : { kind: "data", libraryId: id, accountId };
}
