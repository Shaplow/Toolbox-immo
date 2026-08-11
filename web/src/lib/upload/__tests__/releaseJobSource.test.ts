/**
 * Tests sur `isSourceReleasable`.
 *
 * C'est la règle la plus dangereuse du module upload : un faux positif supprime
 * de R2 le montage d'un monteur ou la vidéo d'un render, en laissant la ligne DB
 * pointer vers un objet disparu. Chaque cas ci-dessous correspond à un scénario
 * réellement produit par le code de production.
 */

import { describe, it, expect } from "vitest";
import { isSourceReleasable } from "@/lib/upload/releaseJobSource";

describe("isSourceReleasable — transcription", () => {
  it("libère un rush uploadé pour une transcription standalone", () => {
    expect(
      isSourceReleasable("transcription", {
        id: "t1",
        inputKey: "transcription/user-1/1700000000/source.mov",
        renderId: null,
        publicationVersionId: null,
      }),
    ).toBe(true);
  });

  it("épargne la vidéo d'un render (pipeline auto via renderId)", () => {
    expect(
      isSourceReleasable("transcription", {
        id: "t2",
        inputKey: "renders/abc/final.mp4",
        renderId: "render-1",
        publicationVersionId: null,
      }),
    ).toBe(false);
  });

  it("épargne la vidéo d'une version montée (pipeline auto via publicationVersionId)", () => {
    // Régression : la branche FAILED du webhook ne testait QUE `renderId` et
    // oubliait `publicationVersionId` — une transcription échouée sur un pattern
    // manual_rushes / external_upload supprimait le montage du monteur.
    expect(
      isSourceReleasable("transcription", {
        id: "t3",
        inputKey: "publications/slot-1/versions/v2.mp4",
        renderId: null,
        publicationVersionId: "version-1",
      }),
    ).toBe(false);
  });

  it("épargne toute clé hors du préfixe dédié, même sans flag pipeline", () => {
    // Deuxième filet : si un jour un chemin écrit une clé étrangère dans
    // inputKey sans poser de flag, le préfixe seul suffit à protéger.
    expect(
      isSourceReleasable("transcription", {
        id: "t4",
        inputKey: "publications/slot-9/versions/final.mp4",
        renderId: null,
        publicationVersionId: null,
      }),
    ).toBe(false);
  });
});

describe("isSourceReleasable — captions", () => {
  it("libère une vidéo uploadée spécifiquement pour le job", () => {
    expect(
      isSourceReleasable("caption", {
        id: "c1",
        inputKey: "inputs/captions/user-1/1700000000/video.mp4",
      }),
    ).toBe(true);
  });

  it("épargne la version montée quand le job utilise la vidéo du slot", () => {
    // Bug de production corrigé : avec « utiliser la vidéo du slot »,
    // resolveSlotSourceVideo met PublicationVersion.r2Key dans inputKey, et le
    // webhook le supprimait sans condition — l'incrustation de sous-titres
    // effaçait donc le montage du monteur.
    expect(
      isSourceReleasable("caption", {
        id: "c2",
        inputKey: "publications/slot-1/versions/v3.mp4",
      }),
    ).toBe(false);
  });

  it("épargne la vidéo d'un render quand le job utilise la vidéo du slot", () => {
    expect(
      isSourceReleasable("caption", {
        id: "c3",
        inputKey: "renders/xyz/final.mp4",
      }),
    ).toBe(false);
  });

  it("n'accepte pas le préfixe de transcription pour un job captions", () => {
    // Les préfixes ne sont pas interchangeables : chaque famille ne peut libérer
    // que ce qu'elle a elle-même uploadé.
    expect(
      isSourceReleasable("caption", {
        id: "c4",
        inputKey: "transcription/user-1/1700000000/source.mov",
      }),
    ).toBe(false);
  });
});

describe("isSourceReleasable — cas limites", () => {
  it("ne fait rien si inputKey est déjà nulle (webhook rejoué)", () => {
    expect(isSourceReleasable("transcription", { id: "t5", inputKey: null })).toBe(false);
    expect(isSourceReleasable("caption", { id: "c5", inputKey: null })).toBe(false);
  });

  it("ignore les clés du stockage disque de dev", () => {
    expect(
      isSourceReleasable("transcription", {
        id: "t6",
        inputKey: "local/transcription/user-1/1700000000/source.mp3",
      }),
    ).toBe(false);
  });

  it("refuse une clé qui ne fait que CONTENIR le préfixe sans commencer par lui", () => {
    // Anti-contournement : un `includes` naïf aurait accepté cette clé.
    expect(
      isSourceReleasable("caption", {
        id: "c6",
        inputKey: "publications/slot-1/inputs/captions/video.mp4",
      }),
    ).toBe(false);
  });
});
