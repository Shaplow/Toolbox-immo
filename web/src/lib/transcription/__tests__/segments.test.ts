import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetFromR2, mockReadFile } = vi.hoisted(() => ({
  mockGetFromR2: vi.fn(),
  mockReadFile: vi.fn(),
}));

vi.mock("@/lib/r2", () => ({ getFromR2: mockGetFromR2 }));
vi.mock("fs/promises", () => ({ readFile: mockReadFile }));

import { loadTranscriptionSegments, parseSegmentsStrict } from "../segments";

const SEGMENTS = [{ start: 0, end: 1, text: "Bonjour" }];

describe("parseSegmentsStrict", () => {
  it("accepte le tableau nu du worker et la forme enveloppée", () => {
    expect(parseSegmentsStrict(JSON.stringify(SEGMENTS))).toEqual(SEGMENTS);
    expect(parseSegmentsStrict(JSON.stringify({ segments: SEGMENTS }))).toEqual(SEGMENTS);
  });

  it("lève sur un contenu illisible (pas de SRT vide silencieux)", () => {
    expect(() => parseSegmentsStrict("pas du json")).toThrow();
    expect(() => parseSegmentsStrict(JSON.stringify({ foo: 1 }))).toThrow("Format de segments inattendu");
  });
});

describe("loadTranscriptionSegments", () => {
  beforeEach(() => {
    mockGetFromR2.mockReset();
    mockReadFile.mockReset();
  });

  it("lit R2 pour une clé de production", async () => {
    mockGetFromR2.mockResolvedValue(Buffer.from(JSON.stringify(SEGMENTS)));
    await expect(loadTranscriptionSegments({ outputJsonKey: "transcription/u/1/segments.json" })).resolves.toEqual(
      SEGMENTS,
    );
    expect(mockGetFromR2).toHaveBeenCalledWith("transcription/u/1/segments.json");
  });

  it("lit le disque pour une clé local/", async () => {
    mockReadFile.mockResolvedValue(Buffer.from(JSON.stringify(SEGMENTS)));
    await expect(
      loadTranscriptionSegments({ outputJsonKey: "local/transcription/u/1/segments.json" }),
    ).resolves.toEqual(SEGMENTS);
    expect(String(mockReadFile.mock.calls[0][0])).toMatch(/public\/transcription\/u\/1\/segments\.json$/);
    expect(mockGetFromR2).not.toHaveBeenCalled();
  });

  it("retombe sur la copie inline si le fichier est illisible", async () => {
    mockGetFromR2.mockRejectedValue(new Error("NoSuchKey"));
    await expect(
      loadTranscriptionSegments({ outputJsonKey: "transcription/u/1/segments.json", segmentsJson: JSON.stringify(SEGMENTS) }),
    ).resolves.toEqual(SEGMENTS);
  });

  it("utilise la copie inline sans clé, et lève sans aucune source", async () => {
    await expect(loadTranscriptionSegments({ outputJsonKey: null, segmentsJson: JSON.stringify(SEGMENTS) })).resolves.toEqual(
      SEGMENTS,
    );
    await expect(loadTranscriptionSegments({ outputJsonKey: null })).rejects.toThrow("Aucun fichier de segments");
  });

  it("propage l'erreur de lecture quand il n'y a pas de repli", async () => {
    mockGetFromR2.mockRejectedValue(new Error("NoSuchKey"));
    await expect(loadTranscriptionSegments({ outputJsonKey: "transcription/u/1/segments.json" })).rejects.toThrow(
      "NoSuchKey",
    );
  });
});
