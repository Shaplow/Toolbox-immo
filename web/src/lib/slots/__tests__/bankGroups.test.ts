/**
 * Le regroupement de la banque.
 *
 * Ce qui compte ici n'est pas « est-ce que ça trie » mais qu'AUCUN statut ne
 * tombe dans un trou : la banque montre tout ce qu'elle contient, sinon une
 * publication sans date devient invisible — exactement le défaut qu'on vient
 * de corriger en retirant le filtre « prêts ».
 */
import { describe, it, expect } from "vitest";
import { BANK_GROUPS, partitionBank } from "@/lib/slots/bankGroups";
import { SLOT_STATUS_META } from "@/lib/slots/statusLabels";
import type { SlotStatus } from "@/types/calendar";

const ALL_STATUSES = Object.keys(SLOT_STATUS_META) as SlotStatus[];

describe("partitionBank", () => {
  it("chaque statut connu tombe dans un groupe OU dans le reste — jamais nulle part", () => {
    const slots = ALL_STATUSES.map((status) => ({ status }));
    const { groups, rest } = partitionBank(slots);
    const placed = groups.reduce((n, g) => n + g.slots.length, 0) + rest.length;
    expect(placed).toBe(ALL_STATUSES.length);
  });

  it("un statut n'appartient jamais à deux groupes", () => {
    const seen = new Set<string>();
    for (const group of BANK_GROUPS) {
      for (const status of group.statuses) {
        expect(seen.has(status)).toBe(false);
        seen.add(status);
      }
    }
  });

  it("les statuts livrables forment le premier groupe", () => {
    expect(BANK_GROUPS[0].key).toBe("ready");
    // SCHEDULED en fait partie depuis la remise en banque : une publication
    // validée qu'on met de côté n'attend plus qu'une date, comme les deux
    // autres.
    expect(BANK_GROUPS[0].statuses).toEqual([
      "EDIT_APPROVED",
      "READY_FOR_CM",
      "SCHEDULED",
    ]);
  });

  it("une publication partie chez le client a son propre groupe", () => {
    // Elles tombaient dans « Autres », rangées avec les accidents.
    const { groups, rest } = partitionBank([
      { status: "AWAITING_CLIENT" as SlotStatus },
      { status: "CLIENT_REVISION" as SlotStatus },
    ]);
    const client = groups.find((g) => g.group.key === "client");
    expect(client?.slots).toHaveLength(2);
    expect(rest).toHaveLength(0);
  });

  it("l'attente de rushs et le montage sont distingués", () => {
    const { groups } = partitionBank([
      { status: "RUSHES_EXPECTED" as SlotStatus },
      { status: "IN_EDIT" as SlotStatus },
    ]);
    const byKey = Object.fromEntries(groups.map((g) => [g.group.key, g.slots.length]));
    expect(byKey.todo).toBe(1);
    expect(byKey.wip).toBe(1);
  });

  it("l'ordre d'entrée est préservé dans chaque groupe", () => {
    const { groups } = partitionBank([
      { status: "EDIT_APPROVED" as SlotStatus, id: "a" },
      { status: "READY_FOR_CM" as SlotStatus, id: "b" },
      { status: "EDIT_APPROVED" as SlotStatus, id: "c" },
    ]);
    expect(groups[0].slots.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  /** Une annulée restée sans date existe : elle doit se voir, pas disparaître. */
  it("un statut hors taxonomie atterrit dans le reste", () => {
    const { rest } = partitionBank([{ status: "CANCELLED" as SlotStatus }]);
    expect(rest).toHaveLength(1);
  });
});
