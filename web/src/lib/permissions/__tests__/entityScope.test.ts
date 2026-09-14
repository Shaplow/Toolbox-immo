/**
 * Tests purs sur entityScope — fige le scoping des fiches (Entity) par rôle,
 * pour les DEUX visibilités (`admin` ex-Property, `team` ex-ShootEvent) :
 *  - whereClauseForUserEntity (dont MONTEUR/CM via reel assigné)
 *  - canUserAccessEntity (cohérent avec le WHERE)
 *  - capacités (create=admin, attach=admin/monteur/vidéaste, upload rushs)
 *
 * Port de permissions/__tests__/eventScope.test.ts.
 */

import { describe, it, expect } from "vitest";
import {
  whereClauseForUserEntity,
  canUserAccessEntity,
  isValidatedForTeam,
  canCreateEntity,
  canAttachSlotToEntity,
  canUploadEntityRushes,
  ALLOWED_ENTITY_PATCH_FIELDS_BY_ROLE,
  type AccessibleEntity,
} from "@/lib/permissions/entityScope";
import type { UserRole } from "@/types/roles";

const ALL_ROLES: UserRole[] = ["ADMIN", "VIDEASTE", "MONTEUR", "CM", "EXTERNAL_GENERATOR"];

describe("whereClauseForUserEntity", () => {
  it("ADMIN → {} (aucune restriction, toutes visibilités)", () => {
    expect(whereClauseForUserEntity("ADMIN", "u1")).toEqual({});
  });

  it("VIDEASTE → team + OR vidéaste fiche | vidéaste d'un reel", () => {
    expect(whereClauseForUserEntity("VIDEASTE", "vid-1")).toEqual({
      type: { visibility: "team" },
      AND: [
        {
          OR: [
            { validationStatus: null },
            { validationStatus: { notIn: ["PENDING_ADMIN", "REJECTED"] } },
          ],
        },
      ],
      OR: [
        { assigneeVideasteId: "vid-1" },
        { shootSlots: { some: { assigneeVideasteId: "vid-1" } } },
      ],
    });
  });

  it("MONTEUR → team + OR défaut monteur | reel assigné", () => {
    expect(whereClauseForUserEntity("MONTEUR", "mon-1")).toEqual({
      type: { visibility: "team" },
      AND: [
        {
          OR: [
            { validationStatus: null },
            { validationStatus: { notIn: ["PENDING_ADMIN", "REJECTED"] } },
          ],
        },
      ],
      OR: [
        { defaultAssigneeMonteurId: "mon-1" },
        { shootSlots: { some: { assigneeMonteurId: "mon-1" } } },
      ],
    });
  });

  it("CM → team + OR défaut cm | reel assigné", () => {
    expect(whereClauseForUserEntity("CM", "cm-1")).toEqual({
      type: { visibility: "team" },
      AND: [
        {
          OR: [
            { validationStatus: null },
            { validationStatus: { notIn: ["PENDING_ADMIN", "REJECTED"] } },
          ],
        },
      ],
      OR: [
        { defaultAssigneeCmId: "cm-1" },
        { shootSlots: { some: { assigneeCmId: "cm-1" } } },
      ],
    });
  });

  it("EXTERNAL_GENERATOR → clause impossible", () => {
    expect(whereClauseForUserEntity("EXTERNAL_GENERATOR", "u1")).toEqual({ id: "__never__" });
  });

  it("aucun rôle non-admin ne peut jamais matcher une fiche `visibility=admin`", () => {
    // Chaque clause non-ADMIN filtre explicitement sur `type.visibility: "team"`
    // (ou est impossible) — une fiche admin ne peut donc jamais matcher.
    for (const role of ALL_ROLES) {
      if (role === "ADMIN") continue;
      const clause = whereClauseForUserEntity(role, "u1") as Record<string, unknown>;
      if (clause.id === "__never__") continue;
      expect(clause.type).toEqual({ visibility: "team" });
    }
  });

  it("aucun rôle équipe ne voit une fiche en attente de validation admin", () => {
    for (const role of ["VIDEASTE", "MONTEUR", "CM"] as UserRole[]) {
      const clause = whereClauseForUserEntity(role, "u1") as Record<string, unknown>;
      expect(clause.AND).toEqual([
        {
          OR: [
            { validationStatus: null },
            { validationStatus: { notIn: ["PENDING_ADMIN", "REJECTED"] } },
          ],
        },
      ]);
    }
  });

  // Régression : un `notIn` seul se traduit par un `NOT IN` SQL, qui vaut
  // UNKNOWN sur une colonne NULL — les fiches créées par l'équipe (le cas
  // majoritaire) disparaissaient alors pour les trois rôles, pendant que
  // `isValidatedForTeam(null)` les acceptait. Liste et détail se
  // contredisaient. La branche `{ validationStatus: null }` est le correctif :
  // la retirer rendrait à nouveau le vidéaste aveugle à ses propres missions.
  it("les fiches sans validation (null) restent visibles par l'équipe", () => {
    for (const role of ["VIDEASTE", "MONTEUR", "CM"] as UserRole[]) {
      const clause = whereClauseForUserEntity(role, "u1") as Record<string, unknown>;
      const and = clause.AND as Array<{ OR: Array<Record<string, unknown>> }>;
      expect(and[0].OR).toContainEqual({ validationStatus: null });
      // `isValidatedForTeam` est le pendant single-resource : les deux doivent
      // s'accorder sur null, sinon on recrée la divergence liste ↔ détail.
      expect(isValidatedForTeam(null)).toBe(true);
    }
  });

  // Le filtre est spreadé À CÔTÉ du `OR` d'assignation : s'il exposait lui
  // aussi un `OR`, il l'écraserait silencieusement et ouvrirait le scope à
  // toutes les fiches d'équipe.
  it("le filtre de validation n'entre pas en collision avec le OR d'assignation", () => {
    for (const role of ["VIDEASTE", "MONTEUR", "CM"] as UserRole[]) {
      const clause = whereClauseForUserEntity(role, "u1") as Record<string, unknown>;
      expect(Array.isArray(clause.OR)).toBe(true);
      expect((clause.OR as unknown[]).length).toBe(2);
    }
  });
});

describe("canUserAccessEntity", () => {
  const teamBase: AccessibleEntity = {
    type: { visibility: "team" },
    validationStatus: "APPROVED",
    assigneeVideasteId: "vid-1",
    defaultAssigneeMonteurId: "mon-1",
    defaultAssigneeCmId: "cm-1",
    shootSlots: [],
  };

  const adminBase: AccessibleEntity = {
    type: { visibility: "admin" },
    validationStatus: null,
    assigneeVideasteId: null,
    defaultAssigneeMonteurId: null,
    defaultAssigneeCmId: null,
    shootSlots: [],
  };

  it("ADMIN → toujours true, quelle que soit la visibilité", () => {
    expect(canUserAccessEntity(teamBase, "ADMIN", "whoever")).toBe(true);
    expect(canUserAccessEntity(adminBase, "ADMIN", "whoever")).toBe(true);
  });

  it("visibility=admin → toujours false pour un non-admin", () => {
    for (const role of ["VIDEASTE", "MONTEUR", "CM", "EXTERNAL_GENERATOR"] as UserRole[]) {
      expect(canUserAccessEntity(adminBase, role, "whoever")).toBe(false);
    }
  });

  it("VIDEASTE (fiche team) → true seulement si assigné", () => {
    expect(canUserAccessEntity(teamBase, "VIDEASTE", "vid-1")).toBe(true);
    expect(canUserAccessEntity(teamBase, "VIDEASTE", "vid-2")).toBe(false);
  });

  it("MONTEUR (fiche team) → via défaut monteur", () => {
    expect(canUserAccessEntity(teamBase, "MONTEUR", "mon-1")).toBe(true);
    expect(canUserAccessEntity(teamBase, "MONTEUR", "mon-2")).toBe(false);
  });

  it("MONTEUR (fiche team) → via reel assigné même sans défaut", () => {
    const ent: AccessibleEntity = {
      ...teamBase,
      defaultAssigneeMonteurId: null,
      shootSlots: [{ assigneeMonteurId: "mon-9", assigneeCmId: null, assigneeVideasteId: null }],
    };
    expect(canUserAccessEntity(ent, "MONTEUR", "mon-9")).toBe(true);
    expect(canUserAccessEntity(ent, "MONTEUR", "mon-1")).toBe(false);
  });

  it("CM (fiche team) → via reel assigné", () => {
    const ent: AccessibleEntity = {
      ...teamBase,
      defaultAssigneeCmId: null,
      shootSlots: [{ assigneeMonteurId: null, assigneeCmId: "cm-9", assigneeVideasteId: null }],
    };
    expect(canUserAccessEntity(ent, "CM", "cm-9")).toBe(true);
    expect(canUserAccessEntity(ent, "CM", "cm-1")).toBe(false);
  });

  it("VIDEASTE (fiche team) → via reel assigné même sans être vidéaste du tournage", () => {
    const ent: AccessibleEntity = {
      ...teamBase,
      assigneeVideasteId: null,
      shootSlots: [{ assigneeMonteurId: null, assigneeCmId: null, assigneeVideasteId: "vid-9" }],
    };
    expect(canUserAccessEntity(ent, "VIDEASTE", "vid-9")).toBe(true);
    expect(canUserAccessEntity(ent, "VIDEASTE", "vid-1")).toBe(false);
  });

  it("fiche en attente de validation admin → invisible pour toute l'équipe", () => {
    const pending: AccessibleEntity = { ...teamBase, validationStatus: "PENDING_ADMIN" };
    expect(canUserAccessEntity(pending, "VIDEASTE", "vid-1")).toBe(false);
    expect(canUserAccessEntity(pending, "MONTEUR", "mon-1")).toBe(false);
    expect(canUserAccessEntity(pending, "CM", "cm-1")).toBe(false);
    // L'admin garde la main : c'est lui qui doit trancher.
    expect(canUserAccessEntity(pending, "ADMIN", "whoever")).toBe(true);
  });

  it("validation null (créée par l'admin) ou côté client → visible", () => {
    for (const st of [null, "APPROVED", "PENDING_CLIENT"]) {
      expect(canUserAccessEntity({ ...teamBase, validationStatus: st }, "VIDEASTE", "vid-1")).toBe(
        true,
      );
    }
    expect(canUserAccessEntity({ ...teamBase, validationStatus: "REJECTED" }, "VIDEASTE", "vid-1")).toBe(
      false,
    );
  });

  it("EXTERNAL_GENERATOR → toujours false", () => {
    expect(canUserAccessEntity(teamBase, "EXTERNAL_GENERATOR", "vid-1")).toBe(false);
    expect(canUserAccessEntity(adminBase, "EXTERNAL_GENERATOR", "vid-1")).toBe(false);
  });
});

describe("capacités par rôle", () => {
  it("canCreateEntity → ADMIN uniquement", () => {
    expect(canCreateEntity("ADMIN")).toBe(true);
    expect(canCreateEntity("VIDEASTE")).toBe(false);
    expect(canCreateEntity("MONTEUR")).toBe(false);
    expect(canCreateEntity("CM")).toBe(false);
    expect(canCreateEntity("EXTERNAL_GENERATOR")).toBe(false);
  });

  it("canAttachSlotToEntity → ADMIN, MONTEUR, VIDEASTE", () => {
    expect(canAttachSlotToEntity("ADMIN")).toBe(true);
    expect(canAttachSlotToEntity("MONTEUR")).toBe(true);
    expect(canAttachSlotToEntity("VIDEASTE")).toBe(true);
    expect(canAttachSlotToEntity("CM")).toBe(false);
    expect(canAttachSlotToEntity("EXTERNAL_GENERATOR")).toBe(false);
  });

  it("canUploadEntityRushes → ADMIN ou vidéaste assigné", () => {
    const ent = { assigneeVideasteId: "vid-1" };
    expect(canUploadEntityRushes(ent, "ADMIN", "x")).toBe(true);
    expect(canUploadEntityRushes(ent, "VIDEASTE", "vid-1")).toBe(true);
    expect(canUploadEntityRushes(ent, "VIDEASTE", "vid-2")).toBe(false);
    expect(canUploadEntityRushes(ent, "MONTEUR", "vid-1")).toBe(false);
  });

  it("ALLOWED_ENTITY_PATCH_FIELDS_BY_ROLE : admin large, autres restreints", () => {
    expect(ALLOWED_ENTITY_PATCH_FIELDS_BY_ROLE.ADMIN).toContain("scheduledAt");
    expect(ALLOWED_ENTITY_PATCH_FIELDS_BY_ROLE.ADMIN).toContain("assigneeVideasteId");
    expect(ALLOWED_ENTITY_PATCH_FIELDS_BY_ROLE.ADMIN).toContain("fields");
    // Relance d'une demande de disponibilité : la garde « null uniquement »
    // vit dans patchEntity, pas ici.
    expect(ALLOWED_ENTITY_PATCH_FIELDS_BY_ROLE.ADMIN).toContain("videasteConfirmation");
    expect(ALLOWED_ENTITY_PATCH_FIELDS_BY_ROLE.ADMIN).toContain("videasteDeclineReason");
    // Égalité stricte volontaire : c'est ce qui rend visible tout élargissement
    // des droits du vidéaste. `brief` y est entré sciemment — il est sur le
    // tournage, il sait ce qui a réellement été filmé.
    expect(ALLOWED_ENTITY_PATCH_FIELDS_BY_ROLE.VIDEASTE).toEqual([
      "status",
      "notes",
      "brief",
      "videasteConfirmation",
      "videasteDeclineReason",
    ]);
    // Les rôles aval ne voient le brief qu'en lecture.
    expect(ALLOWED_ENTITY_PATCH_FIELDS_BY_ROLE.MONTEUR).not.toContain("brief");
    expect(ALLOWED_ENTITY_PATCH_FIELDS_BY_ROLE.CM).not.toContain("brief");
    expect(ALLOWED_ENTITY_PATCH_FIELDS_BY_ROLE.MONTEUR).toEqual(["notes"]);
    expect(ALLOWED_ENTITY_PATCH_FIELDS_BY_ROLE.CM).toEqual(["notes"]);
    expect(ALLOWED_ENTITY_PATCH_FIELDS_BY_ROLE.EXTERNAL_GENERATOR).toEqual([]);
  });
});
