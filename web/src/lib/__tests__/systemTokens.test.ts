import { describe, it, expect } from "vitest";
import {
  resolveSystemTokens,
  formatSystemDate,
  buildMaintenantToken,
  SYSTEM_DATE_PRESETS,
} from "@/lib/systemTokens";

// 2026-06-16T12:30:00Z = 2026-06-16 14:30 Europe/Paris (CEST UTC+2)
// 2026-06-16 est un mardi
const NOW = new Date("2026-06-16T12:30:00Z");

describe("formatSystemDate — presets", () => {
  it("long → '16 juin 2026'", () => {
    expect(formatSystemDate("long", NOW)).toBe("16 juin 2026");
  });

  it("short → '16/06/2026'", () => {
    expect(formatSystemDate("short", NOW)).toBe("16/06/2026");
  });

  it("month_year → 'Juin 2026' (capitalisé)", () => {
    expect(formatSystemDate("month_year", NOW)).toBe("Juin 2026");
  });

  it("month → 'Juin'", () => {
    expect(formatSystemDate("month", NOW)).toBe("Juin");
  });

  it("month_lower → 'juin'", () => {
    expect(formatSystemDate("month_lower", NOW)).toBe("juin");
  });

  it("day_month → '16 juin'", () => {
    expect(formatSystemDate("day_month", NOW)).toBe("16 juin");
  });

  it("weekday_day_month → 'mardi 16 juin'", () => {
    expect(formatSystemDate("weekday_day_month", NOW)).toBe("mardi 16 juin");
  });

  it("weekday → 'mardi'", () => {
    expect(formatSystemDate("weekday", NOW)).toBe("mardi");
  });

  it("year → '2026'", () => {
    expect(formatSystemDate("year", NOW)).toBe("2026");
  });

  it("time → '14:30' (Europe/Paris)", () => {
    expect(formatSystemDate("time", NOW)).toBe("14:30");
  });

  it("datetime → '16/06/2026 14:30'", () => {
    expect(formatSystemDate("datetime", NOW)).toBe("16/06/2026 14:30");
  });

  it("format vide → fallback long", () => {
    expect(formatSystemDate("", NOW)).toBe("16 juin 2026");
  });

  it("format avec espaces seulement → fallback long", () => {
    expect(formatSystemDate("   ", NOW)).toBe("16 juin 2026");
  });
});

describe("formatSystemDate — patterns libres", () => {
  it("'DD/MM/YY' → '16/06/26'", () => {
    expect(formatSystemDate("DD/MM/YY", NOW)).toBe("16/06/26");
  });

  it("'D MMMM YYYY' → '16 juin 2026'", () => {
    expect(formatSystemDate("D MMMM YYYY", NOW)).toBe("16 juin 2026");
  });

  it("'MMM YYYY' → 'juin 2026'", () => {
    expect(formatSystemDate("MMM YYYY", NOW)).toBe("juin 2026");
  });

  it("'HH:mm' → '14:30'", () => {
    expect(formatSystemDate("HH:mm", NOW)).toBe("14:30");
  });

  it("'YYYY-MM-DD' → '2026-06-16'", () => {
    expect(formatSystemDate("YYYY-MM-DD", NOW)).toBe("2026-06-16");
  });

  it("token inconnu reste tel quel", () => {
    expect(formatSystemDate("lol", NOW)).toBe("lol");
  });

  it("pas de bug 'MM dans MMMM'", () => {
    // Si le parser matche d'abord MM dans MMMM ça casse — on s'assure que MMMM est consommé entièrement
    expect(formatSystemDate("MMMM", NOW)).toBe("juin");
    expect(formatSystemDate("MMM", NOW)).toBe("juin");
    expect(formatSystemDate("MM", NOW)).toBe("06");
    expect(formatSystemDate("M", NOW)).toBe("6");
  });
});

describe("resolveSystemTokens", () => {
  it("aucun token → texte inchangé", () => {
    expect(resolveSystemTokens("Bonjour le monde", NOW)).toBe("Bonjour le monde");
  });

  it("string vide → vide", () => {
    expect(resolveSystemTokens("", NOW)).toBe("");
  });

  it("token simple sans format → format long", () => {
    expect(resolveSystemTokens("{{maintenant}}", NOW)).toBe("16 juin 2026");
  });

  it("token avec preset → résolu", () => {
    expect(resolveSystemTokens("Récap {{maintenant:month_year}}", NOW)).toBe("Récap Juin 2026");
  });

  it("plusieurs tokens dans la même string", () => {
    expect(resolveSystemTokens("{{maintenant:month}} - {{maintenant:year}}", NOW)).toBe("Juin - 2026");
  });

  it("token avec pattern libre", () => {
    expect(resolveSystemTokens("Le {{maintenant:D MMMM YYYY}}", NOW)).toBe("Le 16 juin 2026");
  });

  it("token au milieu d'un mot — remplacement strict", () => {
    expect(resolveSystemTokens("abc{{maintenant:year}}def", NOW)).toBe("abc2026def");
  });

  it("format vide explicite '{{maintenant:}}' → long", () => {
    expect(resolveSystemTokens("{{maintenant:}}", NOW)).toBe("16 juin 2026");
  });

  it("texte ressemblant mais invalide reste tel quel", () => {
    expect(resolveSystemTokens("{maintenant:long}", NOW)).toBe("{maintenant:long}");
    expect(resolveSystemTokens("{{ maintenant:long}}", NOW)).toBe("{{ maintenant:long}}");
  });

  it("ne touche pas aux autres patterns {{...}}", () => {
    expect(resolveSystemTokens("Bonjour {{nom}}", NOW)).toBe("Bonjour {{nom}}");
  });
});

describe("buildMaintenantToken", () => {
  it("sans format", () => {
    expect(buildMaintenantToken()).toBe("{{maintenant}}");
  });

  it("avec format", () => {
    expect(buildMaintenantToken("month_year")).toBe("{{maintenant:month_year}}");
  });
});

describe("SYSTEM_DATE_PRESETS", () => {
  it("chaque preset est résolvable et donne un résultat non vide", () => {
    for (const preset of SYSTEM_DATE_PRESETS) {
      const value = formatSystemDate(preset.key, NOW);
      expect(value, `preset ${preset.key}`).toBeTruthy();
    }
  });
});
