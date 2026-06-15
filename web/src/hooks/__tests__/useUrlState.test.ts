import { describe, expect, it } from "vitest";
import { buildUrl } from "../useUrlState";

describe("buildUrl", () => {
  it("ajoute une clé absente", () => {
    expect(buildUrl("/calendar", "", "accountId", "abc")).toBe(
      "/calendar?accountId=abc",
    );
  });

  it("remplace une clé existante", () => {
    expect(
      buildUrl("/calendar", "accountId=old&view=bank", "accountId", "new"),
    ).toBe("/calendar?accountId=new&view=bank");
  });

  it("supprime une clé avec null", () => {
    expect(
      buildUrl("/calendar", "accountId=abc&view=bank", "accountId", null),
    ).toBe("/calendar?view=bank");
  });

  it("supprime une clé avec valeur vide", () => {
    expect(
      buildUrl("/calendar", "accountId=abc&view=bank", "accountId", ""),
    ).toBe("/calendar?view=bank");
  });

  it("supprime une clé qui matche le defaultValue", () => {
    expect(
      buildUrl("/calendar", "view=week&accountId=abc", "view", "week", "week"),
    ).toBe("/calendar?accountId=abc");
  });

  it("retourne pathname seul si plus de params", () => {
    expect(buildUrl("/calendar", "accountId=abc", "accountId", null)).toBe(
      "/calendar",
    );
  });

  it("préserve les autres params", () => {
    expect(
      buildUrl(
        "/calendar",
        "week=2026-06-13&view=bank&filter=overdue",
        "view",
        null,
      ),
    ).toBe("/calendar?week=2026-06-13&filter=overdue");
  });

  it("supporte les caractères spéciaux", () => {
    expect(
      buildUrl("/calendar", "", "q", "hello world"),
    ).toBe("/calendar?q=hello+world");
  });
});
