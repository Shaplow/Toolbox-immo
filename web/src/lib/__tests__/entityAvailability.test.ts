/**
 * Tests purs sur entityAvailability — fige la question « es-tu disponible ? ».
 *
 * Les deux gardes ajoutées (validation, archivage) n'étaient pas dans l'ancienne
 * condition inline : elles étaient couvertes par accident par le scope d'équipe,
 * qui est justement ce qu'on vient de réparer.
 */

import { describe, it, expect } from "vitest";
import { needsVideasteAnswer, isPastShoot } from "@/lib/entityAvailability";

const base = {
  hasPlanning: true,
  status: "PLANNED",
  isArchived: false,
  validationStatus: null,
  videasteConfirmation: null,
};

describe("needsVideasteAnswer", () => {
  it("fiche de tournage planifiée sans réponse → question ouverte", () => {
    expect(needsVideasteAnswer(base)).toBe(true);
  });

  it("validationStatus null (fiche créée par l'équipe) → question ouverte", () => {
    // Le cas majoritaire, et celui que le WHERE excluait à tort.
    expect(needsVideasteAnswer({ ...base, validationStatus: null })).toBe(true);
  });

  it("APPROVED → question ouverte", () => {
    expect(needsVideasteAnswer({ ...base, validationStatus: "APPROVED" })).toBe(true);
  });

  it("PENDING_CLIENT → question ouverte (l'accord client ne bloque pas la prod)", () => {
    expect(needsVideasteAnswer({ ...base, validationStatus: "PENDING_CLIENT" })).toBe(true);
  });

  it("PENDING_ADMIN → non : le serveur refuserait la réponse", () => {
    expect(needsVideasteAnswer({ ...base, validationStatus: "PENDING_ADMIN" })).toBe(false);
  });

  it("REJECTED → non", () => {
    expect(needsVideasteAnswer({ ...base, validationStatus: "REJECTED" })).toBe(false);
  });

  it("fiche archivée → non", () => {
    expect(needsVideasteAnswer({ ...base, isArchived: true })).toBe(false);
  });

  it("déjà confirmée → non", () => {
    expect(needsVideasteAnswer({ ...base, videasteConfirmation: "CONFIRMED" })).toBe(false);
  });

  it("déclinée → OUI : le vidéaste doit pouvoir se raviser", () => {
    expect(needsVideasteAnswer({ ...base, videasteConfirmation: "DECLINED" })).toBe(true);
  });

  it("déjà tournée (SHOT) → non", () => {
    expect(needsVideasteAnswer({ ...base, status: "SHOT" })).toBe(false);
  });

  it("status null → traité comme PLANNED", () => {
    expect(needsVideasteAnswer({ ...base, status: null })).toBe(true);
  });

  it("type sans planning → non", () => {
    expect(needsVideasteAnswer({ ...base, hasPlanning: false })).toBe(false);
  });
});

describe("isPastShoot", () => {
  const now = new Date("2026-09-11T12:00:00Z");

  it("date passée → true", () => {
    expect(isPastShoot("2026-09-10T12:00:00Z", now)).toBe(true);
  });

  it("date future → false", () => {
    expect(isPastShoot("2026-09-12T12:00:00Z", now)).toBe(false);
  });

  it("sans date → false (une mission sans date n'est pas en retard)", () => {
    expect(isPastShoot(null, now)).toBe(false);
  });
});
