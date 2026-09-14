/**
 * Tests computeAnchoredPosition — placement des popovers portalés.
 *
 * Le bug corrigé : « j'ai encore des listes select qui sont carrément décalées
 * de là où je les ouvre, la liste s'ouvre bien plus haut que le champ ». En
 * bascule vers le haut, le popover était posé avec la hauteur ESTIMÉE, pas la
 * sienne — il flottait donc de `maxHeight - hauteurRéelle` pixels.
 *
 * Le verrou central est « bas du popover collé au champ » : c'est la propriété
 * qui était fausse, et la seule qui distingue un placement juste d'un placement
 * qui « a l'air » juste quand la liste est pleine.
 */

import { describe, it, expect } from "vitest";
import {
  computeAnchoredPosition,
  VIEWPORT_MARGIN,
  type AnchoredGeometryInput,
} from "@/lib/ui/anchoredPosition";

const VIEWPORT = { width: 1280, height: 800 };

/** Déclencheur de 200×32 dont on choisit le haut. */
function trigger(top: number, { left = 400, width = 200 } = {}) {
  return { top, bottom: top + 32, left, right: left + width, width };
}

function geometry(over: Partial<AnchoredGeometryInput> = {}) {
  return computeAnchoredPosition({
    trigger: trigger(700),
    popover: null,
    viewport: VIEWPORT,
    scroll: { x: 0, y: 0 },
    maxHeight: 288,
    gap: 6,
    preferTop: false,
    align: "start",
    ...over,
  });
}

describe("placement vertical", () => {
  it("ouvre vers le bas quand la place y est", () => {
    const { top } = geometry({ trigger: trigger(100), popover: { width: 200, height: 98 } });
    expect(top).toBe(138); // 100 + 32 + 6
  });

  /**
   * LE test de régression. Un Select à 3 options (98 px) déclaré
   * `maxHeight: 288` : avant correction il était posé à 700-6-288 = 406, soit
   * 190 px au-dessus de son champ. Le bas de la liste doit toucher le haut du
   * champ, à `gap` près.
   */
  it("un popover court qui bascule colle son BAS au champ", () => {
    const t = trigger(700);
    const { top } = geometry({ trigger: t, popover: { width: 200, height: 98 } });

    expect(top).toBe(596); // 700 - 6 - 98
    expect(top + 98).toBe(t.top - 6); // le bas touche le champ
  });

  it("un popover saturé bascule exactement comme avant la correction", () => {
    // Hauteur réelle == estimation : le calcul historique était juste dans ce
    // seul cas, d'où un bug qui ne se voyait « que parfois ».
    const { top } = geometry({ trigger: trigger(700), popover: { width: 200, height: 288 } });
    expect(top).toBe(406); // 700 - 6 - 288
  });

  it("sans mesure, retombe sur l'estimation maxHeight", () => {
    const { top } = geometry({ trigger: trigger(700), popover: null });
    expect(top).toBe(406);
  });

  it("une hauteur mesurée à 0 retombe aussi sur l'estimation", () => {
    // Popover monté mais pas encore peint : le coller au déclencheur serait
    // pire que l'estimation.
    const { top } = geometry({ trigger: trigger(700), popover: { width: 200, height: 0 } });
    expect(top).toBe(406);
  });

  it("ne bascule pas si le popover tient sous le champ, même si l'estimation ne tenait pas", () => {
    // Le cas que seule la mesure tranche : sous le champ il reste 268 px, soit
    // moins que l'estimation (288) mais bien plus que la liste réelle (100).
    // L'ancien calcul basculait ici, et posait la liste à 206 — 294 px au-dessus
    // du champ. La décision de bascule doit suivre la mesure, pas l'estimation.
    const { top } = geometry({
      trigger: trigger(500),
      popover: { width: 200, height: 100 },
      maxHeight: 288,
    });
    expect(top).toBe(538); // 500 + 32 + 6 → vers le bas
  });

  it("bascule quand la place manque vraiment en bas et qu'il y en a plus en haut", () => {
    const { top } = geometry({ trigger: trigger(700), popover: { width: 200, height: 300 } });
    expect(top).toBe(394); // 700 - 6 - 300
  });

  it("reste vers le bas quand le haut n'offre pas mieux", () => {
    // Déclencheur en haut d'écran : rien au-dessus, on déborde par le bas.
    const { top } = geometry({ trigger: trigger(10), popover: { width: 200, height: 700 } });
    expect(top).toBe(48); // 10 + 32 + 6
  });
});

describe("preferTop", () => {
  it("ouvre vers le haut dès que la place y est", () => {
    const { top } = geometry({
      trigger: trigger(400),
      popover: { width: 120, height: 26 },
      preferTop: true,
      maxHeight: 26,
    });
    expect(top).toBe(368); // 400 - 6 - 26
  });

  it("une bulle multi-lignes ne recouvre plus son déclencheur", () => {
    // Le cas Tooltip : TOOLTIP_HEIGHT = 26 mais la bulle en fait 80.
    const t = trigger(400);
    const { top } = geometry({
      trigger: t,
      popover: { width: 300, height: 80 },
      preferTop: true,
      maxHeight: 26,
    });
    expect(top).toBe(314);
    expect(top + 80).toBe(t.top - 6);
  });

  it("retombe vers le bas quand le haut est trop court", () => {
    const { top } = geometry({
      trigger: trigger(20),
      popover: { width: 200, height: 300 },
      preferTop: true,
    });
    expect(top).toBe(58); // 20 + 32 + 6
  });
});

describe("bornage vertical", () => {
  it("ne sort jamais par le haut", () => {
    const { top } = geometry({ trigger: trigger(500), popover: { width: 200, height: 700 } });
    expect(top).toBe(VIEWPORT_MARGIN);
  });

  /**
   * Bornage ASYMÉTRIQUE, et c'est délibéré : remonter un popover ouvert vers le
   * bas pour le faire tenir le ferait passer PAR-DESSUS son déclencheur, soit
   * exactement le symptôme qu'on corrige. Il déborde et défile à l'intérieur.
   */
  it("ne remonte pas un popover ouvert vers le bas pour le faire tenir", () => {
    const { top } = geometry({ trigger: trigger(10), popover: { width: 200, height: 780 } });
    expect(top).toBe(48);
    expect(top + 780).toBeGreaterThan(VIEWPORT.height);
  });
});

describe("placement horizontal", () => {
  it("aligne à gauche par défaut", () => {
    expect(geometry({ popover: { width: 200, height: 98 } }).left).toBe(400);
  });

  it("`end` aligne les bords droits", () => {
    const { left } = geometry({ popover: { width: 120, height: 98 }, align: "end" });
    expect(left).toBe(480); // 600 - 120
  });

  it("`center` centre sur le déclencheur", () => {
    const { left } = geometry({ popover: { width: 100, height: 98 }, align: "center" });
    expect(left).toBe(450); // 400 + 100 - 50
  });

  it("sans mesure, `end` et `center` retombent sur `start`", () => {
    expect(geometry({ popover: null, align: "end" }).left).toBe(400);
    expect(geometry({ popover: null, align: "center" }).left).toBe(400);
  });

  it("ramène dans le viewport à gauche comme à droite", () => {
    const collé = geometry({
      trigger: trigger(700, { left: 4, width: 40 }),
      popover: { width: 300, height: 98 },
      align: "end",
    });
    expect(collé.left).toBe(VIEWPORT_MARGIN);

    const débordant = geometry({
      trigger: trigger(700, { left: 1200, width: 60 }),
      popover: { width: 300, height: 98 },
    });
    expect(débordant.left).toBe(VIEWPORT.width - 300 - VIEWPORT_MARGIN);
  });
});

describe("coordonnées document", () => {
  it("ajoute le scroll — les popovers sont en position absolute, pas fixed", () => {
    const { top, left } = geometry({
      trigger: trigger(100),
      popover: { width: 200, height: 98 },
      scroll: { x: 30, y: 1000 },
    });
    expect(top).toBe(1138);
    expect(left).toBe(430);
  });

  it("rend la largeur du DÉCLENCHEUR, pas celle du popover", () => {
    const { width } = geometry({ popover: { width: 640, height: 98 } });
    expect(width).toBe(200);
  });
});
