/**
 * Tests purs sur eventScope — fige le scoping des événements par rôle :
 *  - whereClauseForUserEvent (dont MONTEUR/CM via reel assigné)
 *  - canUserAccessEvent (cohérent avec le WHERE)
 *  - capacités (create=admin, attach=admin/monteur/vidéaste, upload rushs)
 */

import { describe, it, expect } from "vitest";
import {
  whereClauseForUserEvent,
  canUserAccessEvent,
  canCreateEvent,
  canAttachReelToEvent,
  canUploadEventRushes,
  ALLOWED_EVENT_PATCH_FIELDS_BY_ROLE,
  type AccessibleEvent,
} from "@/lib/permissions/eventScope";

describe("whereClauseForUserEvent", () => {
  it("ADMIN → {} (aucune restriction)", () => {
    expect(whereClauseForUserEvent("ADMIN", "u1")).toEqual({});
  });

  it("VIDEASTE → filtre sur assigneeVideasteId", () => {
    expect(whereClauseForUserEvent("VIDEASTE", "vid-1")).toEqual({
      assigneeVideasteId: "vid-1",
    });
  });

  it("MONTEUR → OR défaut monteur | reel assigné", () => {
    expect(whereClauseForUserEvent("MONTEUR", "mon-1")).toEqual({
      OR: [
        { defaultAssigneeMonteurId: "mon-1" },
        { slots: { some: { assigneeMonteurId: "mon-1" } } },
      ],
    });
  });

  it("CM → OR défaut cm | reel assigné", () => {
    expect(whereClauseForUserEvent("CM", "cm-1")).toEqual({
      OR: [
        { defaultAssigneeCmId: "cm-1" },
        { slots: { some: { assigneeCmId: "cm-1" } } },
      ],
    });
  });

  it("EXTERNAL_GENERATOR → clause impossible", () => {
    expect(whereClauseForUserEvent("EXTERNAL_GENERATOR", "u1")).toEqual({
      id: "__never__",
    });
  });
});

describe("canUserAccessEvent", () => {
  const base: AccessibleEvent = {
    assigneeVideasteId: "vid-1",
    defaultAssigneeMonteurId: "mon-1",
    defaultAssigneeCmId: "cm-1",
    slots: [],
  };

  it("ADMIN → toujours true", () => {
    expect(canUserAccessEvent(base, "ADMIN", "whoever")).toBe(true);
  });

  it("VIDEASTE → true seulement si assigné", () => {
    expect(canUserAccessEvent(base, "VIDEASTE", "vid-1")).toBe(true);
    expect(canUserAccessEvent(base, "VIDEASTE", "vid-2")).toBe(false);
  });

  it("MONTEUR → via défaut monteur", () => {
    expect(canUserAccessEvent(base, "MONTEUR", "mon-1")).toBe(true);
    expect(canUserAccessEvent(base, "MONTEUR", "mon-2")).toBe(false);
  });

  it("MONTEUR → via reel assigné même sans défaut", () => {
    const ev: AccessibleEvent = {
      ...base,
      defaultAssigneeMonteurId: null,
      slots: [{ assigneeMonteurId: "mon-9", assigneeCmId: null }],
    };
    expect(canUserAccessEvent(ev, "MONTEUR", "mon-9")).toBe(true);
    expect(canUserAccessEvent(ev, "MONTEUR", "mon-1")).toBe(false);
  });

  it("CM → via reel assigné", () => {
    const ev: AccessibleEvent = {
      ...base,
      defaultAssigneeCmId: null,
      slots: [{ assigneeMonteurId: null, assigneeCmId: "cm-9" }],
    };
    expect(canUserAccessEvent(ev, "CM", "cm-9")).toBe(true);
    expect(canUserAccessEvent(ev, "CM", "cm-1")).toBe(false);
  });

  it("EXTERNAL_GENERATOR → toujours false", () => {
    expect(canUserAccessEvent(base, "EXTERNAL_GENERATOR", "vid-1")).toBe(false);
  });
});

describe("capacités par rôle", () => {
  it("canCreateEvent → ADMIN uniquement", () => {
    expect(canCreateEvent("ADMIN")).toBe(true);
    expect(canCreateEvent("VIDEASTE")).toBe(false);
    expect(canCreateEvent("MONTEUR")).toBe(false);
    expect(canCreateEvent("CM")).toBe(false);
  });

  it("canAttachReelToEvent → ADMIN, MONTEUR, VIDEASTE", () => {
    expect(canAttachReelToEvent("ADMIN")).toBe(true);
    expect(canAttachReelToEvent("MONTEUR")).toBe(true);
    expect(canAttachReelToEvent("VIDEASTE")).toBe(true);
    expect(canAttachReelToEvent("CM")).toBe(false);
    expect(canAttachReelToEvent("EXTERNAL_GENERATOR")).toBe(false);
  });

  it("canUploadEventRushes → ADMIN ou vidéaste assigné", () => {
    const ev = { assigneeVideasteId: "vid-1" };
    expect(canUploadEventRushes(ev, "ADMIN", "x")).toBe(true);
    expect(canUploadEventRushes(ev, "VIDEASTE", "vid-1")).toBe(true);
    expect(canUploadEventRushes(ev, "VIDEASTE", "vid-2")).toBe(false);
    expect(canUploadEventRushes(ev, "MONTEUR", "vid-1")).toBe(false);
  });

  it("ALLOWED_EVENT_PATCH_FIELDS_BY_ROLE : admin large, autres restreints", () => {
    expect(ALLOWED_EVENT_PATCH_FIELDS_BY_ROLE.ADMIN).toContain("scheduledAt");
    expect(ALLOWED_EVENT_PATCH_FIELDS_BY_ROLE.ADMIN).toContain("assigneeVideasteId");
    expect(ALLOWED_EVENT_PATCH_FIELDS_BY_ROLE.VIDEASTE).toEqual(["status", "notes"]);
    expect(ALLOWED_EVENT_PATCH_FIELDS_BY_ROLE.MONTEUR).toEqual(["notes"]);
    expect(ALLOWED_EVENT_PATCH_FIELDS_BY_ROLE.CM).toEqual(["notes"]);
    expect(ALLOWED_EVENT_PATCH_FIELDS_BY_ROLE.EXTERNAL_GENERATOR).toEqual([]);
  });
});
