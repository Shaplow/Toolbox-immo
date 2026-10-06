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

  it("purge les clés expirées quand la table est pleine", () => {
    const limiter = createRateLimiter({ windowMs: 1000, max: 1, maxKeys: 3 });
    for (const key of ["a", "b", "c"]) limiter.check(key, 0);
    expect(limiter.size()).toBe(3);

    // Table pleine, a, b et c sont sorties de la fenêtre : la purge les retire
    // TOUTES avant d'ajouter d. Sans purge, l'éviction n'en retirerait qu'une
    // (b, c, d resteraient : 3) — c'est ce qui rend ce test probant.
    expect(limiter.check("d", 5000)).toBe(true);
    expect(limiter.size()).toBe(1);
    expect(limiter.check("a", 5000)).toBe(true);
  });

  it("ne balaie la table qu'une fois par fenêtre", () => {
    const limiter = createRateLimiter({ windowMs: 1000, max: 5, maxKeys: 4 });
    limiter.check("old1", 0);
    limiter.check("old2", 0);
    limiter.check("c1", 4500);
    limiter.check("c2", 4500);

    // 1er balayage (table pleine) : old1 et old2 expirées sont retirées.
    limiter.check("n1", 5000);
    expect(limiter.size()).toBe(3);
    limiter.check("n2", 5100);
    expect(limiter.size()).toBe(4);

    // Table pleine à nouveau, c1 et c2 sont expirées mais le dernier balayage
    // date de 600 ms : pas de second O(n), on n'évince que la plus ancienne (c1).
    // Un balayage à chaque requête les retirerait toutes les deux (3 ici).
    limiter.check("n3", 5600);
    expect(limiter.size()).toBe(4);

    // La fenêtre est écoulée : le balayage repart (c2 et n1 retirées).
    limiter.check("n4", 6000);
    expect(limiter.size()).toBe(3);
  });

  it("plafonne la table sous un balayage d'IP actives, sans jamais dépasser maxKeys", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 10, maxKeys: 100 });
    for (let i = 0; i < 1000; i++) {
      limiter.check(`ip-${i}`, i);
      expect(limiter.size()).toBeLessThanOrEqual(100);
    }
    // Aucune clé n'est expirée : seule l'éviction a pu tenir le plafond.
    expect(limiter.size()).toBe(100);
  });

  it("évince la clé la moins récemment vue, pas la première insérée", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1, maxKeys: 3 });
    limiter.check("a", 0);
    limiter.check("b", 1);
    limiter.check("c", 2);
    // a est refusée (max 1) mais redevient la plus récemment vue : ordre b, c, a.
    expect(limiter.check("a", 3)).toBe(false);

    // Table pleine, rien d'expiré : b est évincée, pas a.
    expect(limiter.check("d", 4)).toBe(true);
    expect(limiter.size()).toBe(3);

    // a garde son historique (toujours bloquée) ; b repart de zéro.
    expect(limiter.check("a", 5)).toBe(false);
    expect(limiter.check("b", 5)).toBe(true);
  });
});
