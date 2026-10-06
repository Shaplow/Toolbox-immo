import { describe, it, expect } from "vitest";
import { createRateLimiter, getClientIp } from "@/lib/http/rateLimit";

function req(headers: Record<string, string>): Request {
  return new Request("https://toolboximmo.com/api/x", { headers });
}

describe("getClientIp", () => {
  it("préfère X-Real-IP, posé par nginx", () => {
    expect(getClientIp(req({ "x-real-ip": "1.2.3.4", "x-forwarded-for": "6.6.6.6, 1.2.3.4" }))).toBe("1.2.3.4");
  });

  it("ignore le premier élément de X-Forwarded-For, choisi par le client", () => {
    expect(getClientIp(req({ "x-forwarded-for": "6.6.6.6, 1.2.3.4" }))).toBe("1.2.3.4");
    expect(getClientIp(req({ "x-forwarded-for": " 5.5.5.5 " }))).toBe("5.5.5.5");
  });

  it("retombe sur unknown sans en-tête exploitable", () => {
    expect(getClientIp(req({}))).toBe("unknown");
    expect(getClientIp(req({ "x-forwarded-for": " , " }))).toBe("unknown");
  });
});

describe("createRateLimiter", () => {
  it("bloque au-delà de max requêtes dans la fenêtre, par clé", () => {
    const limiter = createRateLimiter({ windowMs: 1000, max: 2 });
    expect(limiter.check("a", 0)).toBe(true);
    expect(limiter.check("a", 10)).toBe(true);
    expect(limiter.check("a", 20)).toBe(false);
    expect(limiter.check("b", 20)).toBe(true);
  });

  it("libère la clé quand la fenêtre glisse", () => {
    const limiter = createRateLimiter({ windowMs: 1000, max: 1 });
    expect(limiter.check("a", 0)).toBe(true);
    expect(limiter.check("a", 999)).toBe(false);
    expect(limiter.check("a", 1001)).toBe(true);
  });

  it("purge les clés inactives quand la table déborde", () => {
    const limiter = createRateLimiter({ windowMs: 1000, max: 1, maxKeys: 2 });
    limiter.check("a", 0);
    limiter.check("b", 0);
    limiter.check("c", 0);
    // a, b et c sont expirées : la purge les retire, d passe et a repart à zéro.
    expect(limiter.check("d", 5000)).toBe(true);
    expect(limiter.check("a", 5000)).toBe(true);
  });
});
