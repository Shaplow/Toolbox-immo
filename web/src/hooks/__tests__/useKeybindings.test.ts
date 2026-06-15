import { describe, expect, it } from "vitest";
import { matchKey } from "../useKeybindings";

function ev(opts: Partial<KeyboardEvent>) {
  return {
    key: "",
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...opts,
  } as Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">;
}

describe("matchKey", () => {
  it("matche une simple lettre minuscule", () => {
    expect(matchKey(ev({ key: "j" }), "j")).toBe(true);
  });

  it("matche une lettre case-insensitive (J typé en majuscule sans shift via caps)", () => {
    expect(matchKey(ev({ key: "J" }), "j")).toBe(true);
  });

  it("ne matche pas si modifier inattendu présent", () => {
    expect(matchKey(ev({ key: "j", metaKey: true }), "j")).toBe(false);
    expect(matchKey(ev({ key: "j", shiftKey: true }), "j")).toBe(false);
    expect(matchKey(ev({ key: "j", ctrlKey: true }), "j")).toBe(false);
  });

  it("matche ⌘+K", () => {
    expect(matchKey(ev({ key: "k", metaKey: true }), "k+Meta")).toBe(true);
  });

  it("ne matche pas ⌘+K si meta absent", () => {
    expect(matchKey(ev({ key: "k" }), "k+Meta")).toBe(false);
  });

  it("matche les touches spéciales (ArrowDown)", () => {
    expect(matchKey(ev({ key: "ArrowDown" }), "ArrowDown")).toBe(true);
    expect(matchKey(ev({ key: "ArrowUp" }), "ArrowUp")).toBe(true);
    expect(matchKey(ev({ key: "Escape" }), "Escape")).toBe(true);
    expect(matchKey(ev({ key: "Enter" }), "Enter")).toBe(true);
  });

  it("matche Shift+Enter", () => {
    expect(matchKey(ev({ key: "Enter", shiftKey: true }), "Enter+Shift")).toBe(
      true,
    );
  });

  it("ne matche pas Shift+Enter si shift absent", () => {
    expect(matchKey(ev({ key: "Enter" }), "Enter+Shift")).toBe(false);
  });

  it("supporte les combinaisons Meta + Shift", () => {
    expect(
      matchKey(
        ev({ key: "k", metaKey: true, shiftKey: true }),
        "k+Meta+Shift",
      ),
    ).toBe(true);
  });

  it("alias Cmd équivalent à Meta", () => {
    expect(matchKey(ev({ key: "k", metaKey: true }), "k+Cmd")).toBe(true);
  });
});
