/**
 * Résolution de la transcription : afficher vs réutiliser.
 *
 * Une transcription périmée (`staleSince`) décrit une AUTRE vidéo — montage
 * re-rendu, version promue. La fiche doit continuer à l'afficher pour pouvoir
 * dire « obsolète », mais l'incrustation de sous-titres ne doit jamais la
 * réutiliser : elle poserait le texte de l'ancienne vidéo, décalé, sans signal.
 */

import { describe, it, expect } from "vitest";
import {
  resolveActiveTranscription,
  resolveReusableTranscription,
} from "@/lib/publications/jobLifecycle";

type Job = { id: string; status: string; staleSince: Date | null };

const fresh: Job = { id: "fresh", status: "COMPLETED", staleSince: null };
const stale: Job = { id: "stale", status: "COMPLETED", staleSince: new Date("2026-07-01") };
const running: Job = { id: "running", status: "PROCESSING", staleSince: null };

describe("resolveActiveTranscription — affichage", () => {
  it("renvoie le pointeur explicite même périmé (pour l'afficher comme obsolète)", () => {
    expect(
      resolveActiveTranscription({ activeTranscriptionJob: stale, transcriptionJobs: [] })?.id,
    ).toBe("stale");
  });

  it("préfère un COMPLETED frais dans la liste", () => {
    expect(
      resolveActiveTranscription({ transcriptionJobs: [stale, fresh] })?.id,
    ).toBe("fresh");
  });

  it("retombe sur le plus récent quand aucun n'est frais", () => {
    expect(resolveActiveTranscription({ transcriptionJobs: [stale] })?.id).toBe("stale");
  });

  it("aucun job → null", () => {
    expect(resolveActiveTranscription({ transcriptionJobs: [] })).toBeNull();
  });
});

describe("resolveReusableTranscription — réutilisation", () => {
  it("refuse une transcription périmée pointée explicitement", () => {
    expect(
      resolveReusableTranscription({ activeTranscriptionJob: stale, transcriptionJobs: [] }),
    ).toBeNull();
  });

  it("refuse une transcription périmée issue du fallback", () => {
    expect(resolveReusableTranscription({ transcriptionJobs: [stale] })).toBeNull();
  });

  it("accepte une transcription fraîche", () => {
    expect(resolveReusableTranscription({ transcriptionJobs: [stale, fresh] })?.id).toBe("fresh");
  });

  it("laisse passer un job en cours non périmé (pour l'attendre)", () => {
    expect(
      resolveReusableTranscription({ activeTranscriptionJob: running, transcriptionJobs: [] })?.id,
    ).toBe("running");
  });

  it("aucun job → null", () => {
    expect(resolveReusableTranscription({ transcriptionJobs: [] })).toBeNull();
  });
});
