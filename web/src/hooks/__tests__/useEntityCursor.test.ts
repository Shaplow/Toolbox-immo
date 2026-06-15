import { describe, expect, it } from "vitest";
import { computeCursor } from "../useEntityCursor";

describe("computeCursor", () => {
  it("renvoie -1 / no next / no prev si currentId est null", () => {
    const r = computeCursor(["a", "b", "c"], null);
    expect(r.index).toBe(-1);
    expect(r.total).toBe(3);
    expect(r.hasNext).toBe(false);
    expect(r.hasPrev).toBe(false);
  });

  it("renvoie next mais pas prev sur le premier item", () => {
    const r = computeCursor(["a", "b", "c"], "a");
    expect(r.index).toBe(0);
    expect(r.hasNext).toBe(true);
    expect(r.hasPrev).toBe(false);
  });

  it("renvoie prev et next sur un item du milieu", () => {
    const r = computeCursor(["a", "b", "c"], "b");
    expect(r.index).toBe(1);
    expect(r.hasNext).toBe(true);
    expect(r.hasPrev).toBe(true);
  });

  it("renvoie prev mais pas next sur le dernier item", () => {
    const r = computeCursor(["a", "b", "c"], "c");
    expect(r.index).toBe(2);
    expect(r.hasNext).toBe(false);
    expect(r.hasPrev).toBe(true);
  });

  it("renvoie -1 si currentId absent de la liste", () => {
    const r = computeCursor(["a", "b", "c"], "z");
    expect(r.index).toBe(-1);
    expect(r.hasNext).toBe(false);
    expect(r.hasPrev).toBe(false);
  });

  it("gère une liste vide", () => {
    const r = computeCursor([], "anything");
    expect(r.total).toBe(0);
    expect(r.index).toBe(-1);
    expect(r.hasNext).toBe(false);
    expect(r.hasPrev).toBe(false);
  });

  it("gère une liste à un seul item", () => {
    const r = computeCursor(["only"], "only");
    expect(r.index).toBe(0);
    expect(r.hasNext).toBe(false);
    expect(r.hasPrev).toBe(false);
  });
});
