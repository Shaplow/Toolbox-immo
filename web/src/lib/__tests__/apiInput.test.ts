/**
 * Normalisation des entrées `string[]` des routes bibliothèque.
 *
 * Non-régression : la route PATCH n'acceptait `tags`/`setSequence` que via
 * `Array.isArray(...)` alors que le drawer les envoyait déjà sérialisés en JSON.
 * La condition était toujours fausse → champs jetés en silence, réponse 200,
 * UI qui affiche « enregistré ». C'est ce qui a gelé la `setSequence` des
 * bibliothèques et fait tourner en ordre fixe des bibliothèques affichées « Auto ».
 */

import { describe, it, expect } from "vitest";
import { normalizeStringArrayInput } from "@/lib/apiInput";

describe("normalizeStringArrayInput", () => {
  it("accepte un vrai tableau", () => {
    expect(normalizeStringArrayInput(["a", "b"], "tags")).toEqual({ ok: true, value: ["a", "b"] });
  });

  it("accepte une chaîne JSON (client déployé)", () => {
    expect(normalizeStringArrayInput('["a","b"]', "setSequence")).toEqual({ ok: true, value: ["a", "b"] });
  });

  it("accepte le tableau vide sous ses deux formes — c'est ce qui vide une séquence", () => {
    expect(normalizeStringArrayInput([], "setSequence")).toEqual({ ok: true, value: [] });
    expect(normalizeStringArrayInput("[]", "setSequence")).toEqual({ ok: true, value: [] });
  });

  it("champ absent → aucune mise à jour, pas une erreur", () => {
    expect(normalizeStringArrayInput(undefined, "tags")).toEqual({ ok: true, value: undefined });
    expect(normalizeStringArrayInput(null, "tags")).toEqual({ ok: true, value: undefined });
  });

  it("rejette au lieu d'ignorer : JSON invalide", () => {
    const r = normalizeStringArrayInput("pas du json", "setSequence");
    expect(r.ok).toBe(false);
  });

  it("rejette un JSON valide qui n'est pas un tableau de chaînes", () => {
    expect(normalizeStringArrayInput('{"a":1}', "tags").ok).toBe(false);
    expect(normalizeStringArrayInput("[1,2]", "tags").ok).toBe(false);
    expect(normalizeStringArrayInput([1, 2], "tags").ok).toBe(false);
  });

  it("rejette les types inattendus", () => {
    expect(normalizeStringArrayInput(42, "tags").ok).toBe(false);
    expect(normalizeStringArrayInput(true, "tags").ok).toBe(false);
  });

  it("nomme le champ dans le message d'erreur", () => {
    const r = normalizeStringArrayInput(42, "setSequence");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("setSequence");
  });
});
