/**
 * Tests sur le parsing des segments de transcription.
 *
 * Ces cas encodent un bug qui a tourné en production : le worker écrit un tableau
 * nu, deux consommateurs lisaient `parsed.segments` → texte vide → la génération
 * automatique de description rédigeait depuis une frame vidéo au lieu du
 * transcript, silencieusement. Les deux formes doivent rester acceptées.
 */

import { describe, it, expect } from "vitest";
import {
  parseTranscriptSegments,
  segmentsToText,
  MAX_TRANSCRIPT_CHARS,
} from "@/lib/transcription/transcriptText";

describe("parseTranscriptSegments", () => {
  it("lit le tableau nu produit par le worker RunPod", () => {
    // Forme réelle de segments.json (runpod_worker.py fait _json.dumps(list)).
    const raw = JSON.stringify([
      { start: 0, end: 1.5, text: "Bonjour" },
      { start: 1.5, end: 3, text: "et bienvenue" },
    ]);
    const segments = parseTranscriptSegments(raw);
    expect(segments).toHaveLength(2);
    expect(segments[0].text).toBe("Bonjour");
  });

  it("lit aussi la forme enveloppée { segments: [...] }", () => {
    const raw = JSON.stringify({
      segments: [{ start: 0, end: 1, text: "Coucou" }],
    });
    expect(parseTranscriptSegments(raw)).toHaveLength(1);
  });

  it("préserve les champs de diarisation et de mots", () => {
    const raw = JSON.stringify([
      {
        start: 0,
        end: 1,
        text: "Salut",
        speaker: "SPEAKER_00",
        words: [{ word: "Salut", start: 0, end: 1 }],
      },
    ]);
    const [segment] = parseTranscriptSegments(raw);
    expect(segment.speaker).toBe("SPEAKER_00");
    expect(segment.words).toHaveLength(1);
  });

  it("retourne un tableau vide sur JSON malformé plutôt que de lever", () => {
    expect(parseTranscriptSegments("{pas du json")).toEqual([]);
    expect(parseTranscriptSegments("")).toEqual([]);
  });

  it("retourne un tableau vide sur une forme inattendue", () => {
    expect(parseTranscriptSegments(JSON.stringify({ foo: "bar" }))).toEqual([]);
    expect(parseTranscriptSegments(JSON.stringify("juste une string"))).toEqual([]);
    expect(parseTranscriptSegments(JSON.stringify(null))).toEqual([]);
    // Cas historique du bug : objet avec `segments` non-tableau.
    expect(parseTranscriptSegments(JSON.stringify({ segments: "nope" }))).toEqual([]);
  });
});

describe("segmentsToText", () => {
  it("joint les segments par saut de ligne", () => {
    const text = segmentsToText([
      { start: 0, end: 1, text: "Ligne un" },
      { start: 1, end: 2, text: "Ligne deux" },
    ]);
    expect(text).toBe("Ligne un\nLigne deux");
  });

  it("ignore les segments vides ou sans texte", () => {
    const text = segmentsToText([
      { start: 0, end: 1, text: "Gardé" },
      { start: 1, end: 2, text: "   " },
      { start: 2, end: 3, text: "" },
      // Segment sans `text` du tout (JSON partiel côté worker).
      { start: 3, end: 4 } as never,
      { start: 4, end: 5, text: "Gardé aussi" },
    ]);
    expect(text).toBe("Gardé\nGardé aussi");
  });

  it("trime chaque segment", () => {
    expect(segmentsToText([{ start: 0, end: 1, text: "  espacé  " }])).toBe("espacé");
  });

  it("tronque au plafond demandé", () => {
    const long = [{ start: 0, end: 1, text: "a".repeat(200) }];
    expect(segmentsToText(long, 50)).toHaveLength(50);
  });

  it("applique le plafond par défaut de 50 000 caractères", () => {
    const long = [{ start: 0, end: 1, text: "b".repeat(MAX_TRANSCRIPT_CHARS + 1_000) }];
    expect(segmentsToText(long)).toHaveLength(MAX_TRANSCRIPT_CHARS);
  });

  it("retourne une chaîne vide sur une liste vide", () => {
    expect(segmentsToText([])).toBe("");
  });
});

describe("bout en bout : le format du worker donne bien du texte", () => {
  it("ne renvoie pas une chaîne vide sur un segments.json réel", () => {
    // Régression directe du bug : avec l'ancien `parsed.segments ?? []`,
    // ce cas produisait "" et personne ne s'en apercevait.
    const workerOutput = JSON.stringify([
      { start: 0.0, end: 2.4, text: "Voici le salon", avg_confidence: 0.94 },
      { start: 2.4, end: 5.1, text: "avec vue sur le jardin", avg_confidence: 0.91 },
    ]);
    const text = segmentsToText(parseTranscriptSegments(workerOutput));
    expect(text).toBe("Voici le salon\navec vue sur le jardin");
    expect(text.length).toBeGreaterThan(0);
  });
});
