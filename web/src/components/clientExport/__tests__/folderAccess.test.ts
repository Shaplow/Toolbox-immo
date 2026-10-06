import { describe, expect, it } from "vitest";
import { isFolderReachable } from "../folderAccess";

function domError(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

/** Faux dossier dont `keys()` se comporte comme demandé. */
function folder(keys: (() => AsyncIterable<string>) | undefined): FileSystemDirectoryHandle {
  return { name: "Agence", kind: "directory", keys } as unknown as FileSystemDirectoryHandle;
}

describe("isFolderReachable", () => {
  it("accepte un dossier qui répond (même vide)", async () => {
    const empty = folder(async function* () {});
    const filled = folder(async function* () {
      yield "Sarah";
      yield "Paul";
    });
    expect(await isFolderReachable(empty)).toBe(true);
    expect(await isFolderReachable(filled)).toBe(true);
  });

  it("refuse un dossier supprimé ou déplacé (NotFoundError)", async () => {
    const gone = folder(async function* () {
      throw domError("NotFoundError");
    });
    expect(await isFolderReachable(gone)).toBe(false);
  });

  it("laisse au moteur les autres erreurs (droit retiré…)", async () => {
    const denied = folder(async function* () {
      throw domError("NotAllowedError");
    });
    expect(await isFolderReachable(denied)).toBe(true);
  });

  it("ne bloque pas un navigateur sans keys()", async () => {
    expect(await isFolderReachable(folder(undefined))).toBe(true);
  });

  it("referme l'itérateur sans parcourir tout le dossier", async () => {
    let yielded = 0;
    let closed = false;
    const big = folder(async function* () {
      try {
        for (let i = 0; i < 100_000; i++) {
          yielded++;
          yield `f${i}`;
        }
      } finally {
        closed = true;
      }
    });
    expect(await isFolderReachable(big)).toBe(true);
    expect(yielded).toBe(1);
    expect(closed).toBe(true);
  });
});
