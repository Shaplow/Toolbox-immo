/**
 * pattern-coherence.test.ts
 *
 * Suite de cohérence Pattern × État slot × ProductionChain.
 *
 * Pour 10 patterns canoniques (3 auto_template + 7 manual_rushes/external,
 * ratio reflétant l'usage réel : 30% auto / 70% montage), on déclare 3-4
 * états slot représentatifs et on assert que `computePublicationSteps`
 * sort la chaîne attendue : steps visibles, statuts, nextAction, waitingFor.
 *
 * Objectif : garantir que chaque combinaison de toggles
 * (source / coverMode / needsCaptionsMode / needsDescription /
 * needsClientValidation / allowsClientRevision / needsAdminValidation /
 * needsRushes / needsBrief) produit la chaîne sémantiquement correcte.
 *
 * Quand un test casse, c'est soit que :
 *  - la logique steps.ts a bougé pour de bonnes raisons → mettre à jour
 *    le test correspondant
 *  - la logique steps.ts a un bug → reproduire dans `steps.test.ts` puis fix
 */

import { describe, it, expect } from "vitest";
import { computePublicationSteps, type StepKey, type StepStatus } from "@/lib/publications/steps";

// ── Types & helpers ──────────────────────────────────────────────────────────

type Pattern = Parameters<typeof computePublicationSteps>[0]["pattern"];
type Slot = Parameters<typeof computePublicationSteps>[0]["slot"];
type Input = Parameters<typeof computePublicationSteps>[0];

/** Génère un Pattern avec defaults sains, surchargeable. allowsClientRevision et
 *  needsAdminValidation ne sont pas (encore) dans le Pick consommé par
 *  computePublicationSteps mais on les accepte ici pour documenter la config
 *  du pattern testée — ils seront utilisés quand la chaîne intégrera ces flags. */
function pattern(
  overrides: Partial<NonNullable<Pattern>> & {
    allowsClientRevision?: boolean;
    needsAdminValidation?: boolean;
  } = {},
): NonNullable<Pattern> {
  const { allowsClientRevision: _acr, needsAdminValidation: _nav, ...patternOverrides } = overrides;
  void _acr;
  void _nav;
  return {
    source: "manual_rushes",
    coverMode: "none",
    needsCaptions: false,
    needsCaptionsMode: "none",
    needsDescription: "none",
    needsClientValidation: false,
    needsRushes: false,
    needsBrief: false,
    ...patternOverrides,
  };
}

/** Map step key → status attendu. `undefined` = step non visible (filtré). */
type ExpectedChain = Partial<Record<StepKey, StepStatus | "absent">>;

function expectChain(input: Input, expected: ExpectedChain) {
  const steps = computePublicationSteps(input);
  for (const [key, want] of Object.entries(expected) as [StepKey, StepStatus | "absent"][]) {
    const step = steps.find((s) => s.key === key);
    if (want === "absent") {
      expect(step?.visible ?? false, `step ${key} doit être absent (visible=false)`).toBe(false);
    } else {
      expect(step?.visible, `step ${key} doit être visible`).toBe(true);
      expect(step?.status, `step ${key}.status attendu ${want}`).toBe(want);
    }
  }
}

function nextActionKey(input: Input): StepKey | null {
  const steps = computePublicationSteps(input);
  return steps.find((s) => s.nextAction)?.key ?? null;
}

function waitingForOf(input: Input, key: StepKey): string | undefined {
  const steps = computePublicationSteps(input);
  return steps.find((s) => s.key === key)?.waitingFor;
}

// ── Patterns canoniques (10) ─────────────────────────────────────────────────

// AUTO_TEMPLATE (30% du trafic)

/** 1. Pattern auto le plus fluide : tout auto, validation client off. */
const P_AUTO_FLUIDE = pattern({
  source: "auto_template",
  coverMode: "autoPack",
  needsCaptions: true,
  needsCaptionsMode: "auto",
  needsDescription: "autoGenerate",
  needsClientValidation: false,
});

/** 2. Pattern auto avec validation client + ping-pong (cas Premium). */
const P_AUTO_AVEC_VALIDATION = pattern({
  source: "auto_template",
  coverMode: "autoPack",
  needsCaptions: true,
  needsCaptionsMode: "auto",
  needsDescription: "autoGenerate",
  needsClientValidation: true,
  allowsClientRevision: true,
});

/** 3. Pattern auto minimal : juste le render, pas de captions/desc/cover. */
const P_AUTO_MINIMAL = pattern({
  source: "auto_template",
  coverMode: "none",
  needsCaptions: false,
  needsCaptionsMode: "none",
  needsDescription: "none",
  needsClientValidation: false,
});

// MANUAL_RUSHES (70%)

/** 4. Pattern manual classique : rushs → montage → captions auto → desc auto → cover auto. */
const P_MANUAL_CLASSIQUE = pattern({
  source: "manual_rushes",
  coverMode: "autoPack",
  needsCaptions: true,
  needsCaptionsMode: "auto",
  needsDescription: "autoGenerate",
  needsClientValidation: false,
  needsRushes: true,
  needsBrief: true,
});

/** 5. Pattern manual tout-manuel (captions + desc + cover sélectionnés à la main). */
const P_MANUAL_TOUT_MANUEL = pattern({
  source: "manual_rushes",
  coverMode: "manualSelect",
  needsCaptions: false,
  needsCaptionsMode: "manual",
  needsDescription: "manualWrite",
  needsClientValidation: false,
  needsRushes: true,
});

/** 6. Pattern où le monteur uploade la cover lui-même. */
const P_MANUAL_COVER_MONTEUR = pattern({
  source: "manual_rushes",
  coverMode: "monteurUpload",
  needsCaptions: true,
  needsCaptionsMode: "auto",
  needsDescription: "manualWrite",
  needsRushes: true,
});

/** 7. Pattern avec validation admin (admin valide le montage avant le client). */
const P_MANUAL_VALIDATION_ADMIN = pattern({
  source: "manual_rushes",
  coverMode: "autoPack",
  needsCaptions: true,
  needsCaptionsMode: "auto",
  needsDescription: "autoGenerate",
  needsAdminValidation: true,
  needsClientValidation: true,
  needsRushes: true,
});

/** 8. Pattern ping-pong : validation client + révisions client autorisées. */
const P_MANUAL_PING_PONG = pattern({
  source: "manual_rushes",
  coverMode: "autoPack",
  needsCaptions: true,
  needsCaptionsMode: "auto",
  needsDescription: "autoGenerate",
  needsClientValidation: true,
  allowsClientRevision: true,
  needsRushes: true,
});

/** 9. Pattern manual_rushes mais sans rushs : monteur livre la version finie direct. */
const P_MANUAL_SANS_RUSHES = pattern({
  source: "manual_rushes",
  coverMode: "manualSelect",
  needsCaptionsMode: "manual",
  needsDescription: "manualWrite",
  needsRushes: false,
  needsBrief: false,
});

/** 10. Pattern external_upload : le client uploade la vidéo finie, pas de montage interne. */
const P_EXTERNAL = pattern({
  source: "external_upload",
  coverMode: "manualSelect",
  needsCaptionsMode: "none",
  needsDescription: "manualWrite",
  needsClientValidation: false,
});

// ── Tests par pattern × état slot ─────────────────────────────────────────────

describe("Pattern 1 — auto_template fluide (captions auto + desc auto + cover auto)", () => {
  it("état initial (PLANNED, pas de render) : Rushs non visible, render todo nextAction", () => {
    const input: Input = { slot: { status: "PLANNED", description: null }, pattern: P_AUTO_FLUIDE };
    expectChain(input, {
      rushes: "absent",
      render: "todo",
      edit: "absent",
      captions: "waiting",
      description: "waiting",
      cover: "waiting",
      validation: "absent",
      publish: "waiting",
    });
    expect(nextActionKey(input)).toBe("render");
  });

  it("render DONE + captions PROCESSING : captions=processing, description en waiting", () => {
    const input: Input = {
      slot: { status: "READY_FOR_CM", description: null },
      pattern: P_AUTO_FLUIDE,
      renderJob: { status: "DONE" },
      captionJob: { status: "PROCESSING" },
    };
    expectChain(input, {
      render: "done",
      captions: "processing",
      // descriptionJob PROCESSING ne change pas le statut côté chain (le helper
      // ne mappe que COMPLETED/FAILED) — captions encore PROCESSING bloque
      // l'amont donc description = waiting.
      description: "waiting",
    });
    expect(waitingForOf(input, "description")).toBe("Sous-titres");
  });

  it("tout fini, slot AWAITING_CLIENT : validation client n'est PAS visible (off pour ce pattern)", () => {
    const input: Input = {
      slot: { status: "AWAITING_CLIENT", description: "Texte légende" },
      pattern: P_AUTO_FLUIDE,
      renderJob: { status: "DONE" },
      captionJob: { status: "COMPLETED" },
      descriptionJob: { status: "COMPLETED", result: "Texte légende" },
      coverPack: { status: "SELECTED", finalCoverUrl: "https://example.com/cover.png" },
    };
    expectChain(input, {
      validation: "absent",
      publish: "todo",
    });
    expect(nextActionKey(input)).toBe("publish");
  });

  it("PUBLISHED : publish=done, rien d'autre actionnable", () => {
    const input: Input = {
      slot: { status: "PUBLISHED", description: "X" },
      pattern: P_AUTO_FLUIDE,
      renderJob: { status: "DONE" },
      captionJob: { status: "COMPLETED" },
      descriptionJob: { status: "COMPLETED", result: "X" },
      coverPack: { status: "SELECTED", finalCoverUrl: "https://example.com/c.png" },
    };
    expectChain(input, { publish: "done" });
    expect(nextActionKey(input)).toBe(null);
  });
});

describe("Pattern 2 — auto_template avec validation client + ping-pong", () => {
  it("captions COMPLETED → validation est l'action attendue", () => {
    const input: Input = {
      slot: { status: "READY_FOR_CM", description: "OK" },
      pattern: P_AUTO_AVEC_VALIDATION,
      renderJob: { status: "DONE" },
      captionJob: { status: "COMPLETED" },
      descriptionJob: { status: "COMPLETED", result: "OK" },
      coverPack: { status: "SELECTED", finalCoverUrl: "https://example.com/c.png" },
    };
    expectChain(input, {
      validation: "todo",
      publish: "waiting",
    });
    expect(nextActionKey(input)).toBe("validation");
  });

  it("captions PROCESSING → validation est BLOQUÉE (pas todo)", () => {
    const input: Input = {
      slot: { status: "READY_FOR_CM", description: null },
      pattern: P_AUTO_AVEC_VALIDATION,
      renderJob: { status: "DONE" },
      captionJob: { status: "PROCESSING" },
    };
    expectChain(input, {
      captions: "processing",
      validation: "blocked",
    });
  });

  it("SCHEDULED = client a validé → validation=done, publish=todo", () => {
    const input: Input = {
      slot: { status: "SCHEDULED", description: "OK" },
      pattern: P_AUTO_AVEC_VALIDATION,
      renderJob: { status: "DONE" },
      captionJob: { status: "COMPLETED" },
      descriptionJob: { status: "COMPLETED", result: "OK" },
      coverPack: { status: "SELECTED", finalCoverUrl: "https://example.com/c.png" },
    };
    expectChain(input, { validation: "done", publish: "todo" });
    expect(nextActionKey(input)).toBe("publish");
  });
});

describe("Pattern 3 — auto_template minimal (juste le render, rien d'autre)", () => {
  it("seuls render et publish sont visibles", () => {
    const input: Input = { slot: { status: "PLANNED", description: null }, pattern: P_AUTO_MINIMAL };
    expectChain(input, {
      rushes: "absent",
      render: "todo",
      edit: "absent",
      captions: "absent",
      description: "absent",
      cover: "absent",
      validation: "absent",
      publish: "waiting",
    });
    expect(nextActionKey(input)).toBe("render");
  });

  it("render DONE → publish actionable direct", () => {
    const input: Input = {
      slot: { status: "READY_FOR_CM", description: null },
      pattern: P_AUTO_MINIMAL,
      renderJob: { status: "DONE" },
    };
    expectChain(input, { render: "done", publish: "todo" });
    expect(nextActionKey(input)).toBe("publish");
  });
});

describe("Pattern 4 — manual_rushes classique (full pipeline humain + auto)", () => {
  it("état initial : rushs nextAction, render absent (pas auto_template)", () => {
    const input: Input = {
      slot: { status: "PLANNED", description: null },
      pattern: P_MANUAL_CLASSIQUE,
    };
    expectChain(input, {
      rushes: "todo",
      render: "absent",
      edit: "waiting",
      captions: "waiting",
      description: "waiting",
      cover: "waiting",
      publish: "waiting",
    });
    expect(nextActionKey(input)).toBe("rushes");
    expect(waitingForOf(input, "edit")).toBe("Rushs");
  });

  it("rushs reçus, pas encore de version → edit=todo, captions waiting", () => {
    const input: Input = {
      slot: { status: "RUSHES_RECEIVED", description: null },
      pattern: P_MANUAL_CLASSIQUE,
      rushesCount: 2,
    };
    expectChain(input, {
      rushes: "done",
      edit: "todo",
      captions: "waiting",
    });
    expect(nextActionKey(input)).toBe("edit");
    expect(waitingForOf(input, "captions")).toBe("Montage");
  });

  it("version promue + captions+desc+cover faits → publish actionable", () => {
    const input: Input = {
      slot: { status: "READY_FOR_CM", description: "Légende" },
      pattern: P_MANUAL_CLASSIQUE,
      rushesCount: 2,
      currentVersionId: "v1",
      captionJob: { status: "COMPLETED" },
      descriptionJob: { status: "COMPLETED", result: "Légende" },
      coverPack: { status: "SELECTED", finalCoverUrl: "https://example.com/c.png" },
    };
    expectChain(input, {
      rushes: "done",
      edit: "done",
      captions: "done",
      description: "done",
      cover: "done",
      publish: "todo",
    });
    expect(nextActionKey(input)).toBe("publish");
  });
});

describe("Pattern 5 — manual_rushes tout-manuel (captions manual + cover manualSelect + desc manualWrite)", () => {
  it("rushs uploadés, version pas promue → edit=processing (versions livrées mais pas current)", () => {
    const input: Input = {
      slot: { status: "RUSHES_RECEIVED", description: null },
      pattern: P_MANUAL_TOUT_MANUEL,
      rushesCount: 1,
      versionsCount: 1,
      currentVersionId: null,
    };
    expectChain(input, {
      rushes: "done",
      edit: "processing",
      captions: "waiting",
      cover: "waiting",
    });
    // edit en processing → captions est encore en waiting (pas done)
    expect(waitingForOf(input, "captions")).toBe("Montage");
  });

  it("version promue + captions manual sauvés + cover sélectionnée → publish todo", () => {
    const input: Input = {
      slot: { status: "READY_FOR_CM", description: "OK" },
      pattern: P_MANUAL_TOUT_MANUEL,
      rushesCount: 1,
      currentVersionId: "v1",
      captionJob: { status: "COMPLETED" },
      coverPack: { status: "SELECTED", finalCoverUrl: "https://example.com/c.png" },
    };
    expectChain(input, {
      captions: "done",
      description: "done",
      cover: "done",
      publish: "todo",
    });
  });

  it("staleSince sur le captionJob → captions retourne à todo (V8.5 fix)", () => {
    const input: Input = {
      slot: { status: "READY_FOR_CM", description: null },
      pattern: P_MANUAL_TOUT_MANUEL,
      rushesCount: 1,
      currentVersionId: "v1",
      captionJob: { status: "COMPLETED", staleSince: new Date() },
    };
    expectChain(input, {
      captions: "todo",
    });
  });
});

describe("Pattern 6 — cover monteurUpload", () => {
  it("step cover est visible et concerne le MONTEUR (pas seulement CM)", () => {
    const input: Input = {
      slot: { status: "RUSHES_RECEIVED", description: null },
      pattern: P_MANUAL_COVER_MONTEUR,
      rushesCount: 1,
    };
    const steps = computePublicationSteps(input);
    const cover = steps.find((s) => s.key === "cover");
    expect(cover?.visible).toBe(true);
    expect(cover?.roles).toContain("MONTEUR");
    expect(cover?.roles).toContain("CM");
  });
});

describe("Pattern 7 — validation admin avant validation client", () => {
  it("captions PAS COMPLETED : validation client = blocked (capt prêtes nécessaires)", () => {
    const input: Input = {
      slot: { status: "EDIT_APPROVED", description: null },
      pattern: P_MANUAL_VALIDATION_ADMIN,
      rushesCount: 1,
      versionsCount: 1,
      currentVersionId: "v1",
      captionJob: { status: "PROCESSING" },
    };
    expectChain(input, {
      captions: "processing",
      validation: "blocked", // règle métier : pas d'envoi client sans captions
      publish: "waiting",
    });
  });

  it("captions COMPLETED + EDIT_APPROVED : validation devient todo (admin a déjà promu)", () => {
    const input: Input = {
      slot: { status: "EDIT_APPROVED", description: "Texte" },
      pattern: P_MANUAL_VALIDATION_ADMIN,
      rushesCount: 1,
      versionsCount: 1,
      currentVersionId: "v1",
      captionJob: { status: "COMPLETED" },
      descriptionJob: { status: "COMPLETED", result: "Texte" },
      coverPack: { status: "SELECTED", finalCoverUrl: "https://example.com/c.png" },
    };
    expectChain(input, {
      validation: "todo",
    });
  });
});

describe("Pattern 8 — ping-pong validation client", () => {
  it("status CLIENT_REVISION : validation = 'failed' (client a refusé, action correctrice attendue)", () => {
    // V8.7 — Avant : "todo" générique, confondu avec un envoi initial.
    // Maintenant : "failed" → la chaîne signale visuellement que la
    // validation a été refusée et qu'il faut corriger + renvoyer.
    const input: Input = {
      slot: { status: "CLIENT_REVISION", description: "Texte" },
      pattern: P_MANUAL_PING_PONG,
      rushesCount: 1,
      currentVersionId: "v1",
      captionJob: { status: "COMPLETED" },
      descriptionJob: { status: "COMPLETED", result: "Texte" },
      coverPack: { status: "SELECTED", finalCoverUrl: "https://example.com/c.png" },
    };
    const steps = computePublicationSteps(input);
    const validation = steps.find((s) => s.key === "validation");
    expect(validation?.visible).toBe(true);
    expect(validation?.status).toBe("failed");
    // failed re-déclenche nextAction (avec todo) — c'est l'étape correctrice
    // qui attend l'action du CM.
    expect(validation?.nextAction).toBe(true);
  });
});

describe("Pattern 9 — manual_rushes sans rushes (livraison directe sans phase shoot)", () => {
  it("step rushes ABSENT, edit done, captions = nextAction (1er actionable)", () => {
    const input: Input = {
      slot: { status: "PLANNED", description: null },
      pattern: P_MANUAL_SANS_RUSHES,
      versionsCount: 1,
      currentVersionId: "v1",
    };
    expectChain(input, {
      rushes: "absent",
      edit: "done",
      // edit est l'amont direct (rushes absent), edit=done → captions devient
      // todo et reçoit nextAction. Pas de "waiting" pour ce step.
      captions: "todo",
      cover: "waiting",
      publish: "waiting",
    });
    expect(nextActionKey(input)).toBe("captions");
  });
});

describe("Pattern 10 — external_upload (le client uploade la vidéo finie)", () => {
  it("rushs absent, edit visible mais done (version uploadée), description en nextAction", () => {
    // Note : edit reste visible car versionsCount > 0 (la version uploadée
    // par le client). C'est conceptuellement "Montage" mais sans monteur
    // interne — sert juste à montrer que la vidéo est arrivée.
    const input: Input = {
      slot: { status: "PLANNED", description: null },
      pattern: P_EXTERNAL,
      versionsCount: 1,
      currentVersionId: "v1",
    };
    expectChain(input, {
      rushes: "absent",
      edit: "done",
      captions: "absent",
      description: "todo",
      // Description doit être faite avant cover dans l'ordre éditorial →
      // cover en waiting tant que description=todo.
      cover: "waiting",
      publish: "waiting",
    });
    expect(nextActionKey(input)).toBe("description");
    expect(waitingForOf(input, "cover")).toBe("Description");
  });
});

// ── V8.7 — Trous comblés ──────────────────────────────────────────────────────

describe("V8.7 — descriptionJobStatus reflète PROCESSING / QUEUED", () => {
  it("descriptionJob PROCESSING → step description = 'processing' (pas 'todo')", () => {
    const input: Input = {
      slot: { status: "READY_FOR_CM", description: null },
      pattern: P_AUTO_FLUIDE,
      renderJob: { status: "DONE" },
      captionJob: { status: "COMPLETED" },
      descriptionJob: { status: "PROCESSING", result: null },
    };
    const steps = computePublicationSteps(input);
    expect(steps.find((s) => s.key === "description")?.status).toBe("processing");
  });

  it("descriptionJob QUEUED → step description = 'queued'", () => {
    const input: Input = {
      slot: { status: "READY_FOR_CM", description: null },
      pattern: P_AUTO_FLUIDE,
      renderJob: { status: "DONE" },
      captionJob: { status: "COMPLETED" },
      descriptionJob: { status: "QUEUED", result: null },
    };
    const steps = computePublicationSteps(input);
    expect(steps.find((s) => s.key === "description")?.status).toBe("queued");
  });
});

describe("V8.7 — external_upload : step 'edit' renommé 'Vidéo'", () => {
  it("source=external_upload → label edit = 'Vidéo'", () => {
    const steps = computePublicationSteps({
      slot: { status: "PLANNED", description: null },
      pattern: P_EXTERNAL,
      versionsCount: 1,
      currentVersionId: "v1",
    });
    const edit = steps.find((s) => s.key === "edit");
    expect(edit?.label).toBe("Vidéo");
  });

  it("source=manual_rushes → label edit = 'Montage'", () => {
    const steps = computePublicationSteps({
      slot: { status: "PLANNED", description: null },
      pattern: P_MANUAL_CLASSIQUE,
    });
    const edit = steps.find((s) => s.key === "edit");
    expect(edit?.label).toBe("Montage");
  });
});

// ── Invariants transverses ────────────────────────────────────────────────────

describe("Invariants — quoiqu'il arrive", () => {
  const ALL_PATTERNS = [
    P_AUTO_FLUIDE,
    P_AUTO_AVEC_VALIDATION,
    P_AUTO_MINIMAL,
    P_MANUAL_CLASSIQUE,
    P_MANUAL_TOUT_MANUEL,
    P_MANUAL_COVER_MONTEUR,
    P_MANUAL_VALIDATION_ADMIN,
    P_MANUAL_PING_PONG,
    P_MANUAL_SANS_RUSHES,
    P_EXTERNAL,
  ];

  it("publish est toujours visible sur tous les patterns", () => {
    for (const p of ALL_PATTERNS) {
      const steps = computePublicationSteps({ slot: { status: "PLANNED", description: null }, pattern: p });
      const publish = steps.find((s) => s.key === "publish");
      expect(publish?.visible, `pattern ${p.source}/${p.coverMode} : publish visible`).toBe(true);
    }
  });

  it("au plus UN step a nextAction=true à la fois", () => {
    for (const p of ALL_PATTERNS) {
      const steps = computePublicationSteps({ slot: { status: "PLANNED", description: null }, pattern: p });
      const count = steps.filter((s) => s.nextAction).length;
      expect(count, `pattern ${p.source}/${p.coverMode} : nextAction unique`).toBeLessThanOrEqual(1);
    }
  });

  it("un step en `waiting` a TOUJOURS un waitingFor non vide", () => {
    for (const p of ALL_PATTERNS) {
      const steps = computePublicationSteps({ slot: { status: "PLANNED", description: null }, pattern: p });
      for (const s of steps) {
        if (s.status === "waiting" && s.visible) {
          expect(s.waitingFor, `${p.source} step ${s.key} waiting sans waitingFor`).toBeTruthy();
        }
      }
    }
  });

  it("statut PUBLISHED → publish=done sur tous les patterns", () => {
    for (const p of ALL_PATTERNS) {
      const steps = computePublicationSteps({
        slot: { status: "PUBLISHED", description: "x" },
        pattern: p,
      });
      const publish = steps.find((s) => s.key === "publish");
      expect(publish?.status, `${p.source}/${p.coverMode} : PUBLISHED → publish done`).toBe("done");
    }
  });
});
