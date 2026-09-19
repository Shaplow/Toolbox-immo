/**
 * Tests du helper de collaborateurs — les règles que la création et l'édition
 * doivent appliquer à l'identique.
 *
 * Elles vivaient uniquement dans `setSlotCollabs`. Les recopier à la création
 * aurait garanti qu'elles divergent, et la première à tomber aurait été le
 * plafond Instagram — que le CM aurait découvert seul, devant son téléphone.
 */

import { describe, it, expect } from "vitest";
import { normalizeCollabAccountIds } from "@/lib/publications/collabs";
import { MAX_SLOT_COLLABS } from "@/lib/publications/constants";
import { SHARED_USAGE_ACCOUNT_ID } from "@/lib/rotation/sentinels";
import { ValidationError } from "@/lib/services/_runtime/errors";

describe("normalizeCollabAccountIds — ce qui entre", () => {
  it("un champ absent n'est pas une erreur", () => {
    expect(normalizeCollabAccountIds(undefined, "acc-main")).toEqual([]);
    expect(normalizeCollabAccountIds(null, "acc-main")).toEqual([]);
  });

  it("encaisse un body mal formé sans exploser", () => {
    // `POST /api/calendar/slots` passe le body du client tel quel au service.
    expect(normalizeCollabAccountIds("acc-1", "acc-main")).toEqual([]);
    expect(normalizeCollabAccountIds([1, 2, null, "", "  "], "acc-main")).toEqual([]);
  });

  it("dédoublonne", () => {
    expect(normalizeCollabAccountIds(["a", "b", "a"], "acc-main")).toEqual(["a", "b"]);
  });
});

describe("normalizeCollabAccountIds — ce qui est refusé", () => {
  it("au-delà du plafond Instagram", () => {
    const tooMany = Array.from({ length: MAX_SLOT_COLLABS + 1 }, (_, i) => `acc-${i}`);
    expect(() => normalizeCollabAccountIds(tooMany, "acc-main")).toThrow(ValidationError);
  });

  it("les doublons ne comptent pas double dans le plafond", () => {
    const ids = Array.from({ length: MAX_SLOT_COLLABS }, (_, i) => `acc-${i}`);
    expect(() => normalizeCollabAccountIds([...ids, ids[0]], "acc-main")).not.toThrow();
  });

  it("le compte qui publie ne peut pas être son propre collaborateur", () => {
    expect(() => normalizeCollabAccountIds(["acc-main"], "acc-main")).toThrow(ValidationError);
  });

  it("sur une publication sans compte, il n'y a rien à comparer", () => {
    // Le compte sera posé plus tard ; `assignSlotAccount` purgera alors la
    // ligne devenue fausse.
    expect(normalizeCollabAccountIds(["acc-1"], null)).toEqual(["acc-1"]);
  });
});

describe("normalizeCollabAccountIds — les comptes sentinelles", () => {
  it("sont retirés en silence, pas rejetés", () => {
    // Ce sont des comptes virtuels de la médiathèque qui ont fuité dans une
    // liste : faire échouer la création pour un choix que personne n'a fait
    // serait pire que de les ignorer.
    expect(normalizeCollabAccountIds([SHARED_USAGE_ACCOUNT_ID, "acc-1"], "acc-main")).toEqual([
      "acc-1",
    ]);
  });

  it("ne consomment pas de place sous le plafond", () => {
    const ids = Array.from({ length: MAX_SLOT_COLLABS }, (_, i) => `acc-${i}`);
    expect(() =>
      normalizeCollabAccountIds([...ids, SHARED_USAGE_ACCOUNT_ID], "acc-main"),
    ).not.toThrow();
  });
});
