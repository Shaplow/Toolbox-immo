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

  it("VIDEASTE → team + assigneeVideasteId", () => {
    expect(whereClauseForUserEntity("VIDEASTE", "vid-1")).toEqual({
      type: { visibility: "team" },
      assigneeVideasteId: "vid-1",
    });
  });

  it("MONTEUR → team + OR défaut monteur | reel assigné", () => {
    expect(whereClauseForUserEntity("MONTEUR", "mon-1")).toEqual({
      type: { visibility: "team" },
      OR: [
        { defaultAssigneeMonteurId: "mon-1" },
        { shootSlots: { some: { assigneeMonteurId: "mon-1" } } },
      ],
    });
  });

  it("CM → team + OR défaut cm | reel assigné", () => {
    expect(whereClauseForUserEntity("CM", "cm-1")).toEqual({
      type: { visibility: "team" },
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
});

describe("canUserAccessEntity", () => {
  const teamBase: AccessibleEntity = {
    type: { visibility: "team" },
    assigneeVideasteId: "vid-1",
    defaultAssigneeMonteurId: "mon-1",
    defaultAssigneeCmId: "cm-1",
    shootSlots: [],
  };

  const adminBase: AccessibleEntity = {
    type: { visibility: "admin" },
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
      shootSlots: [{ assigneeMonteurId: "mon-9", assigneeCmId: null }],
    };
    expect(canUserAccessEntity(ent, "MONTEUR", "mon-9")).toBe(true);
    expect(canUserAccessEntity(ent, "MONTEUR", "mon-1")).toBe(false);
  });

  it("CM (fiche team) → via reel assigné", () => {
    const ent: AccessibleEntity = {
      ...teamBase,
      defaultAssigneeCmId: null,
      shootSlots: [{ assigneeMonteurId: null, assigneeCmId: "cm-9" }],
    };
    expect(canUserAccessEntity(ent, "CM", "cm-9")).toBe(true);
    expect(canUserAccessEntity(ent, "CM", "cm-1")).toBe(false);
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
    expect(ALLOWED_ENTITY_PATCH_FIELDS_BY_ROLE.VIDEASTE).toEqual(["status", "notes"]);
    expect(ALLOWED_ENTITY_PATCH_FIELDS_BY_ROLE.MONTEUR).toEqual(["notes"]);
    expect(ALLOWED_ENTITY_PATCH_FIELDS_BY_ROLE.CM).toEqual(["notes"]);
    expect(ALLOWED_ENTITY_PATCH_FIELDS_BY_ROLE.EXTERNAL_GENERATOR).toEqual([]);
  });
});
