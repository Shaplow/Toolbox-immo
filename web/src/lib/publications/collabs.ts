/**
 * Les comptes invités en collaborateur sur une publication — les règles, sans
 * base de données.
 *
 * Sur Instagram, un post en collab part d'UN compte qui invite les autres : il
 * apparaît ensuite sur tous les profils. Ces règles valaient déjà pour
 * `setSlotCollabs` ; elles valent à l'identique à la création. Les tenir à deux
 * endroits, c'est garantir qu'elles divergeront — et la première à tomber
 * serait le plafond Instagram, que le CM découvrirait seul devant son
 * téléphone.
 *
 * Module PUR : pas d'I/O, donc utilisable aussi bien par le service que par les
 * écrans. La vérification d'EXISTENCE des comptes reste côté service, elle
 * demande la base.
 */

import { ValidationError } from "@/lib/services/_runtime/errors";
import { isSharedSentinel } from "@/lib/rotation/sentinels";
import { MAX_SLOT_COLLABS } from "./constants";

/**
 * Normalise une liste de comptes collaborateurs et vérifie ce qui se vérifie
 * sans base.
 *
 * `raw` est volontairement `unknown` : `POST /api/calendar/slots` passe le body
 * du client tel quel au service, sans whitelist (contrairement à la route
 * `collabs`, qui filtre). Ce qui n'est pas un tableau de chaînes non vides est
 * ignoré, pas rejeté — un champ absent n'est pas une erreur.
 *
 * `mainAccountId` doit être le compte RÉSOLU de la publication, pas celui du
 * body : à la création, une fiche tournage peut l'écraser.
 */
export function normalizeCollabAccountIds(
  raw: unknown,
  mainAccountId: string | null,
): string[] {
  if (!Array.isArray(raw)) return [];

  const ids = [
    ...new Set(
      raw.filter((id): id is string => typeof id === "string" && id.trim().length > 0),
    ),
  ]
    // Les comptes sentinelles (`__shared__`) sont de la plomberie médiathèque,
    // pas des comptes que l'admin a choisis : ils ont fuité dans une liste. On
    // les retire en silence plutôt que de faire échouer une création pour un
    // choix que personne n'a fait. Le filtre client de SlotDetailPanel testait
    // le handle ; ici c'est l'id, comme la source unique.
    .filter((id) => !isSharedSentinel(id));

  // Le plafond s'applique APRÈS la déduplication : deux fois le même compte ne
  // compte pas double (verrouillé par les tests de setSlotCollabs).
  if (ids.length > MAX_SLOT_COLLABS) {
    throw new ValidationError(
      `Instagram n'accepte pas plus de ${MAX_SLOT_COLLABS} collaborateurs sur une publication.`,
    );
  }

  // Se mettre en collab avec soi-même : la consigne afficherait deux fois le
  // même compte au CM, qui chercherait ce qu'il a raté. Sur une mission sans
  // compte, il n'y a rien à comparer — et c'est cohérent : le compte sera posé
  // plus tard, `assignSlotAccount` purgera alors la ligne devenue fausse.
  if (mainAccountId && ids.includes(mainAccountId)) {
    throw new ValidationError(
      "Le compte qui publie ne peut pas être aussi son propre collaborateur.",
    );
  }

  return ids;
}
