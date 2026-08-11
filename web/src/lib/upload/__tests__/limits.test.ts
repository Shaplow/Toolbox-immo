/**
 * Tests sur les helpers de plafonds d'upload.
 *
 * Enjeu réel : ces valeurs pilotent à la fois la garde client et la garde
 * serveur. Un formatage qui dérive produit un message d'erreur qui mentionne un
 * plafond différent de celui réellement appliqué — le pire cas pour un
 * utilisateur qui vient d'attendre un upload de plusieurs heures.
 */

import { describe, it, expect } from "vitest";
import {
  UPLOAD_LIMITS,
  MULTIPART,
  formatMaxSize,
  tooLargeMessage,
} from "@/lib/upload/limits";

describe("formatMaxSize", () => {
  it("formate les valeurs entières sans décimale superflue", () => {
    expect(formatMaxSize(100 * 1024 ** 3)).toBe("100 Go");
    expect(formatMaxSize(2 * 1024 ** 3)).toBe("2 Go");
    expect(formatMaxSize(50 * 1024 ** 2)).toBe("50 Mo");
    expect(formatMaxSize(20 * 1024 ** 2)).toBe("20 Mo");
  });

  it("utilise la virgule décimale française pour les valeurs non entières", () => {
    expect(formatMaxSize(1.5 * 1024 ** 3)).toBe("1,5 Go");
    expect(formatMaxSize(2.5 * 1024 ** 2)).toBe("2,5 Mo");
  });

  it("descend en Ko puis en octets sous le seuil du Mo", () => {
    expect(formatMaxSize(512 * 1024)).toBe("512 Ko");
    expect(formatMaxSize(900)).toBe("900 o");
  });

  it("bascule d'unité pile au seuil, pas au-dessus", () => {
    expect(formatMaxSize(1024 ** 3)).toBe("1 Go");
    expect(formatMaxSize(1024 ** 3 - 1)).toMatch(/Mo$/);
    expect(formatMaxSize(1024 ** 2)).toBe("1 Mo");
    expect(formatMaxSize(1024 ** 2 - 1)).toMatch(/Ko$/);
  });
});

describe("tooLargeMessage", () => {
  it("dérive le plafond affiché de la constante appliquée", () => {
    expect(tooLargeMessage(UPLOAD_LIMITS.RUSH_MAX_BYTES)).toBe(
      "Fichier trop volumineux (max 100 Go)",
    );
    expect(tooLargeMessage(UPLOAD_LIMITS.BRIEF_ATTACHMENT_MAX_BYTES)).toBe(
      "Fichier trop volumineux (max 50 Mo)",
    );
  });
});

describe("invariants multipart", () => {
  it("garde un nombre de parties sous le plafond R2 de 10 000 au plafond de rush", () => {
    const parts = Math.ceil(UPLOAD_LIMITS.RUSH_MAX_BYTES / MULTIPART.PART_SIZE_BYTES);
    expect(parts).toBeLessThanOrEqual(10_000);
    // Garde-fou de latence : le prepare signe les URLs en série et renvoie tout
    // en une réponse. Au-delà de ~2000 parties, cette réponse devient lourde.
    expect(parts).toBeLessThanOrEqual(2_000);
  });

  it("respecte le minimum S3/R2 de 5 Mo par partie", () => {
    expect(MULTIPART.PART_SIZE_BYTES).toBeGreaterThanOrEqual(5 * 1024 ** 2);
  });

  it("ne dépasse jamais le plafond dur SigV4 de 7 jours pour l'expiry des parties", () => {
    expect(MULTIPART.PART_URL_EXPIRY_SECONDS).toBeLessThanOrEqual(7 * 24 * 60 * 60);
  });

  it("garde le seuil de bascule multipart sous la limite du PUT unique R2 (5 Go)", () => {
    expect(MULTIPART.THRESHOLD_BYTES).toBeLessThan(5 * 1024 ** 3);
  });

  it("plafonne les chemins non-multipart sous la limite du PUT unique R2", () => {
    // Ces chemins n'ont pas de multipart : au-delà de 5 Go, R2 renvoie
    // EntityTooLarge. Les laisser sous ce seuil est le comportement correct.
    expect(UPLOAD_LIMITS.VIDEO_ASSET_MAX_BYTES).toBeLessThan(5 * 1024 ** 3);
    expect(UPLOAD_LIMITS.AUDIO_ASSET_MAX_BYTES).toBeLessThan(5 * 1024 ** 3);
  });

  it("aligne le plafond des chemins traversant le serveur sur client_max_body_size (2 Go)", () => {
    expect(UPLOAD_LIMITS.SERVER_PROXIED_MAX_BYTES).toBe(2 * 1024 ** 3);
  });
});
