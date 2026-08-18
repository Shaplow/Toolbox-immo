/**
 * Tests validateBindingInput — gardes partagées du sous-payload `binding` de
 * POST/PATCH /api/admin/accounts/[id]/recipes[/[bindingId]].
 */
import { describe, it, expect } from "vitest";
import { validateBindingInput } from "@/lib/services/pattern/bindingInput";

describe("validateBindingInput", () => {
  it("publishTime manquant (requireAll=true, ex. POST) → erreur", () => {
    expect(validateBindingInput({}, { requireAll: true })).toMatch(/publishTime requis/);
  });

  it("publishTime absent (requireAll=false, ex. PATCH) → ok", () => {
    expect(validateBindingInput({}, { requireAll: false })).toBeNull();
  });

  it("publishTime mal formé → erreur", () => {
    expect(validateBindingInput({ publishTime: "25:99" }, { requireAll: false })).toMatch(/HH:MM/);
  });

  it("dayOfWeek hors 1-7 → erreur", () => {
    expect(validateBindingInput({ dayOfWeek: [0, 3] }, { requireAll: false })).toMatch(/entiers 1-7/);
  });

  it("coverModeOverride invalide → erreur", () => {
    expect(
      validateBindingInput({ coverModeOverride: "not_a_real_mode" }, { requireAll: false }),
    ).toMatch(/coverModeOverride invalide/);
  });

  it("fieldPrefix préfixe les messages d'erreur", () => {
    expect(
      validateBindingInput({}, { requireAll: true, fieldPrefix: "binding." }),
    ).toBe("binding.publishTime requis");
  });

  it("payload valide → ok (null)", () => {
    expect(
      validateBindingInput(
        { publishTime: "09:30", dayOfWeek: [1, 3, 5], coverModeOverride: null },
        { requireAll: true },
      ),
    ).toBeNull();
  });
});
