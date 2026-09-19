import { describe, it, expect } from "vitest";
import { computeShootSteps, type ShootStepsInput } from "../shootSteps";

const base: ShootStepsInput = {
  hasPlanning: true,
  hasAssignees: true,
  isArchived: false,
  status: "PLANNED",
  validationStatus: "APPROVED",
  scheduledAt: "2026-09-28T10:47:00.000Z",
  assigneeVideasteId: "u-videaste",
  videasteConfirmation: "CONFIRMED",
  rushCount: 0,
  slotStatuses: [],
};

const step = (input: Partial<ShootStepsInput>, key: string) =>
  computeShootSteps({ ...base, ...input }).find((s) => s.key === key)!;

describe("computeShootSteps", () => {
  it("suit l'ordre planifié → disponibilité → tourné → publications", () => {
    expect(computeShootSteps(base).map((s) => s.key)).toEqual([
      "planned",
      "confirmed",
      "shot",
      "published",
    ]);
  });

  describe("planifié", () => {
    it("est fait dès qu'une date est posée", () => {
      expect(step({}, "planned").status).toBe("done");
    });

    it("reste à faire sans date, et le dit", () => {
      const s = step({ scheduledAt: null }, "planned");
      expect(s.status).toBe("todo");
      expect(s.hint).toBe("Aucune date posée");
    });
  });

  describe("disponibilité", () => {
    it("échoue quand le vidéaste s'est déclaré indisponible", () => {
      // Le cas le plus urgent : personne ne sera sur place le jour J.
      expect(step({ videasteConfirmation: "DECLINED" }, "confirmed").status).toBe("failed");
    });

    it("attend tant que la question est ouverte", () => {
      expect(step({ videasteConfirmation: null }, "confirmed").status).toBe("todo");
    });

    it("signale l'absence d'assigné plutôt que de prétendre attendre une réponse", () => {
      const s = step({ assigneeVideasteId: null, videasteConfirmation: null }, "confirmed");
      expect(s.status).toBe("todo");
      expect(s.hint).toBe("Aucun vidéaste assigné");
    });

    it("se ferme quand le tournage a eu lieu sans réponse explicite", () => {
      // needsVideasteAnswer ne considère plus la question ouverte hors PLANNED :
      // réclamer une disponibilité pour un tournage déjà fait n'a pas de sens.
      expect(step({ status: "SHOT", videasteConfirmation: null }, "confirmed").status).toBe("done");
    });

    it("disparaît si le type ne porte pas d'assignés", () => {
      expect(step({ hasAssignees: false }, "confirmed").visible).toBe(false);
    });
  });

  describe("tourné", () => {
    it("est fait par « Marquer réalisé », sans aucun rush", () => {
      const s = step({ status: "SHOT", rushCount: 0 }, "shot");
      expect(s.status).toBe("done");
      expect(s.hint).toBeUndefined();
    });

    it("est fait par le dépôt de rushs, qui bascule le statut côté serveur", () => {
      const s = step({ status: "SHOT", rushCount: 3 }, "shot");
      expect(s.status).toBe("done");
      expect(s.hint).toBe("3 rushs");
    });

    it("accorde le décompte au singulier", () => {
      expect(step({ status: "SHOT", rushCount: 1 }, "shot").hint).toBe("1 rush");
    });
  });

  describe("publications", () => {
    it("n'est faite que lorsque toutes les publications sont terminées", () => {
      // Tournage fait : sans ça la règle d'amont met « Publications » en
      // attente, ce qui est le comportement voulu mais masque ce qu'on teste.
      const shot = { status: "SHOT" as const };
      expect(step({ ...shot, slotStatuses: ["PUBLISHED", "IN_EDIT"] }, "published").status)
        .toBe("todo");
      expect(step({ ...shot, slotStatuses: ["PUBLISHED", "CANCELLED"] }, "published").status)
        .toBe("done");
    });

    it("attend que le tournage ait eu lieu", () => {
      const s = step({ status: "PLANNED", slotStatuses: ["IN_EDIT"] }, "published");
      expect(s.status).toBe("waiting");
      expect(s.waitingFor).toBe("Tournage");
    });

    it("compte plutôt que d'afficher un statut muet", () => {
      expect(step({ slotStatuses: ["PUBLISHED", "IN_EDIT"] }, "published").hint)
        .toBe("1 sur 2 terminées");
      expect(step({ slotStatuses: [] }, "published").hint).toBe("Aucune publication rattachée");
    });

    it("n'est pas rétrogradée par une étape amont en retard", () => {
      // `statusDriven` : des reels peuvent être publiés alors que la fiche
      // n'a jamais reçu de date. La chaîne ne doit pas le nier.
      const s = step(
        { scheduledAt: null, slotStatuses: ["PUBLISHED"] },
        "published",
      );
      expect(s.status).toBe("done");
    });
  });

  describe("prochaine action", () => {
    it("porte une phrase d'action, pas seulement le nom de l'étape", () => {
      // Le bandeau « à toi » affiche `action` : « Tournage » décrirait un état,
      // pas ce qu'on attend de la personne.
      const steps = computeShootSteps({ ...base, scheduledAt: null });
      expect(steps.find((s) => s.nextAction)?.action).toBe("Poser la date du tournage");
    });

    it("adapte l'action à ce qui manque vraiment", () => {
      const s = step({ assigneeVideasteId: null, videasteConfirmation: null }, "confirmed");
      expect(s.action).toBe("Assigner un vidéaste");
    });

    it("désigne la première étape réellement faisable", () => {
      const steps = computeShootSteps({ ...base, scheduledAt: null });
      expect(steps.find((s) => s.nextAction)?.key).toBe("planned");
    });

    it("saute les étapes déjà faites", () => {
      const steps = computeShootSteps({ ...base, videasteConfirmation: null });
      expect(steps.find((s) => s.nextAction)?.key).toBe("confirmed");
    });

    it("met en attente ce qui suit une étape non terminée, en le nommant", () => {
      const steps = computeShootSteps({ ...base, scheduledAt: null });
      const shot = steps.find((s) => s.key === "shot")!;
      expect(shot.status).toBe("waiting");
      expect(shot.waitingFor).toBe("Planification");
    });
  });
});
