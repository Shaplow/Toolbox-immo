import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
const { applyExcludeZones } = await import("@/lib/triggerAutoCaptionFromTranscription");

type Segment = { start: number; end: number; text: string };

const seg = (start: number, end: number, text = "..."): Segment => ({ start, end, text });

describe("applyExcludeZones — trim partiel (cas user)", () => {
  it("zone vide → segments inchangés", () => {
    const segs = [seg(0, 5), seg(5, 10)];
    expect(applyExcludeZones(segs, [], 10)).toEqual(segs);
  });

  it("segment entièrement dans une zone exclue → supprimé", () => {
    const segs = [seg(2, 4, "killed")];
    const zones = [{ startSec: 0, endSec: 5 }];
    expect(applyExcludeZones(segs, zones, 10)).toEqual([]);
  });

  it("segment qui dépasse partiellement une zone exclue à droite → trim au boundary", () => {
    // Cas user : intro 0-10s, content 10-25s exclu. Segment transcription
    // 0-25s qui couvre intro + content. Doit être rogné à 0-10.
    const segs = [seg(0, 25, "phrase intro qui déborde sur content")];
    const zones = [{ startSec: 10, endSec: null }]; // content + outro
    const result = applyExcludeZones(segs, zones, 28);
    expect(result).toHaveLength(1);
    expect(result[0].start).toBe(0);
    expect(result[0].end).toBe(10);
    expect(result[0].text).toBe("phrase intro qui déborde sur content");
  });

  it("segment qui dépasse partiellement une zone exclue à gauche → trim", () => {
    const segs = [seg(8, 15, "...")];
    const zones = [{ startSec: 0, endSec: 10 }]; // intro
    const result = applyExcludeZones(segs, zones, 30);
    expect(result).toHaveLength(1);
    expect(result[0].start).toBe(10);
    expect(result[0].end).toBe(15);
  });

  it("segment qui contient une zone exclue au milieu → split en 2 pièces", () => {
    const segs = [seg(0, 20, "...")];
    const zones = [{ startSec: 8, endSec: 12 }];
    const result = applyExcludeZones(segs, zones, 30);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ start: 0, end: 8 });
    expect(result[1]).toMatchObject({ start: 12, end: 20 });
  });

  it("zone endSec=null + videoDuration → utilise videoDuration", () => {
    const segs = [seg(5, 28, "...")];
    const zones = [{ startSec: 10, endSec: null }];
    const result = applyExcludeZones(segs, zones, 28);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ start: 5, end: 10 });
  });

  it("plusieurs zones → soustraction successive", () => {
    const segs = [seg(0, 30, "...")];
    const zones = [
      { startSec: 5, endSec: 10 },
      { startSec: 20, endSec: 25 },
    ];
    const result = applyExcludeZones(segs, zones, 30);
    expect(result).toHaveLength(3);
    expect(result.map((r) => [r.start, r.end])).toEqual([
      [0, 5],
      [10, 20],
      [25, 30],
    ]);
  });

  it("trim laisse pièce trop courte (< 150ms) → ignorée", () => {
    const segs = [seg(0, 5.05, "...")];
    const zones = [{ startSec: 5.0, endSec: 10 }]; // ne laisse que 5-5.05 = 50ms intersection
    // Pas de trim côté gauche (0-5.0 = 5s, OK), donc on garde 1 segment.
    const result = applyExcludeZones(segs, zones, 30);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ start: 0, end: 5 });

    // Cas où le résidu < MIN_SEG_DUR_AFTER_TRIM est ignoré
    const segs2 = [seg(9.95, 15, "...")];
    const zones2 = [{ startSec: 10, endSec: 14.99 }];
    // Reste : [9.95, 10] = 50ms et [14.99, 15] = 10ms → tous deux ignorés
    expect(applyExcludeZones(segs2, zones2, 30)).toEqual([]);
  });
});
