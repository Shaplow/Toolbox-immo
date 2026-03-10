import type { DPEBlock } from "@/types/template";
import type { ListingData } from "@/types/listing";
import { blockBaseStyle } from "../styleUtils";

// ─── Couleurs et libellés officiels ────────────────────────────────────────────

const LETTERS = ["A", "B", "C", "D", "E", "F", "G"] as const;
type Letter = typeof LETTERS[number];

/** Couleurs officielles DPE consommation énergétique */
const ENERGY_FILL: Record<Letter, string> = {
  A: "#009944", B: "#52B848", C: "#AEC931",
  D: "#FFF200", E: "#F7A800", F: "#E2521C", G: "#CC1719",
};
const ENERGY_TEXT: Record<Letter, string> = {
  A: "#fff", B: "#fff", C: "#1A1A1A",
  D: "#1A1A1A", E: "#1A1A1A", F: "#fff", G: "#fff",
};

/** Couleurs officielles GES émissions CO₂ */
const CLIMATE_FILL: Record<Letter, string> = {
  A: "#C8E0F0", B: "#87BEDF", C: "#6898C0",
  D: "#4F7898", E: "#3D5D7C", F: "#2B4360", G: "#1B2C3C",
};
const CLIMATE_TEXT: Record<Letter, string> = {
  A: "#1A1A1A", B: "#1A1A1A", C: "#fff",
  D: "#fff", E: "#fff", F: "#fff", G: "#fff",
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ─── SVG Diagramme Énergie ─────────────────────────────────────────────────────

function buildEnergySvg(activeLetter: string, kwhValue: string, co2Value: string): string {
  const ai = LETTERS.indexOf(activeLetter.toUpperCase() as Letter);

  const barStartX  = 140;
  const barWidths  = [112, 146, 180, 214, 248, 282, 316];
  const slotH      = 42;
  const normalH    = 32;
  const activeH    = 42;   // = slotH → zéro débordement
  const arrowN     = 18;
  const arrowA     = 30;

  // Boîtes de valeurs flottantes alignées sur la barre active
  const boxH        = 56;
  const rawCenterY  = ai >= 0 ? 24 + ai * slotH + slotH / 2 : 24 + 2 * slotH + slotH / 2;
  const boxTop      = Math.min(Math.max(Math.round(rawCenterY - boxH / 2), 17), 360 - 34 - boxH);

  // Bracket "passoire" à droite des barres (toujours visible)
  const fSlotTop    = 24 + 5 * slotH;
  const gSlotBottom = 24 + 7 * slotH;
  const passMidY    = Math.round((fSlotTop + gSlotBottom) / 2);
  const brkX        = 490; // à droite de la plus longue flèche active (486)

  let bars = "";
  for (let i = 0; i < 7; i++) {
    const L       = LETTERS[i];
    const isAct   = i === ai;
    const slotY   = 24 + i * slotH;
    const h       = isAct ? activeH : normalH;
    const yBar    = slotY + (slotH - h) / 2;
    const endX    = barStartX + barWidths[i];
    const tipX    = endX + (isAct ? arrowA : arrowN);
    const yMid    = yBar + h / 2;
    const pts     = `${barStartX},${yBar} ${endX},${yBar} ${tipX},${yMid} ${endX},${yBar + h} ${barStartX},${yBar + h}`;
    const fSize   = isAct ? 26 : 11;
    bars += `<polygon points="${pts}" fill="${ENERGY_FILL[L]}"${isAct ? ` stroke="black" stroke-width="3" stroke-linejoin="round"` : ""}/>` ;
    bars += `<text x="${barStartX + 14}" y="${yMid}" font-family="Arial,Helvetica,sans-serif" font-size="${fSize}" font-weight="${isAct ? 700 : 600}" fill="${ENERGY_TEXT[L]}" dominant-baseline="central">${L}</text>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 540 360" preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%;display:block;">
  <text x="${barStartX}" y="16" text-anchor="start" font-family="Arial,Helvetica,sans-serif" font-size="12" font-weight="700" fill="#009944">Logement très performant</text>
  <rect x="2" y="${boxTop}" width="66" height="${boxH}" fill="white" stroke="#bbb" stroke-width="0.8"/>
  <text x="35" y="${boxTop + 10}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="5.5" fill="#444">consommation</text>
  <text x="35" y="${boxTop + 18}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="5" fill="#666">(énergie primaire)</text>
  <text x="35" y="${boxTop + 39}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="16" font-weight="700" fill="#1A1A1A">${esc(kwhValue)}</text>
  <text x="35" y="${boxTop + 52}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="6" fill="#555">kWh/m&#xB2;.an</text>
  <rect x="72" y="${boxTop}" width="62" height="${boxH}" fill="white" stroke="#bbb" stroke-width="0.8"/>
  <text x="103" y="${boxTop + 10}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="5.5" fill="#444">émissions</text>
  <text x="103" y="${boxTop + 35}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="16" font-weight="700" fill="#1A1A1A">${esc(co2Value)}</text>
  <text x="103" y="${boxTop + 48}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="6" fill="#555">kg CO&#x2082;/m&#xB2;.an</text>
  <line x1="${brkX}" y1="${fSlotTop + 2}" x2="${brkX}" y2="${gSlotBottom - 2}" stroke="#aaa" stroke-width="0.8"/>
  <line x1="${brkX - 6}" y1="${fSlotTop + 2}" x2="${brkX}" y2="${fSlotTop + 2}" stroke="#aaa" stroke-width="0.8"/>
  <line x1="${brkX - 6}" y1="${gSlotBottom - 2}" x2="${brkX}" y2="${gSlotBottom - 2}" stroke="#aaa" stroke-width="0.8"/>
  <text x="${brkX + 4}" y="${passMidY - 5}" font-family="Arial,Helvetica,sans-serif" font-size="5.5" fill="#888" font-style="italic">passoire</text>
  <text x="${brkX + 4}" y="${passMidY + 6}" font-family="Arial,Helvetica,sans-serif" font-size="5.5" fill="#888" font-style="italic">énergétique</text>
  ${bars}
  <text x="${barStartX}" y="352" text-anchor="start" font-family="Arial,Helvetica,sans-serif" font-size="12" font-weight="700" fill="#CC1719">Logement extrêmement peu performant</text>
</svg>`;
}

// ─── SVG Diagramme Climat (GES) ────────────────────────────────────────────────

function buildClimateSvg(activeLetter: string, climateValue: string): string {
  const ai = LETTERS.indexOf(activeLetter.toUpperCase() as Letter);

  // ViewBox 365×360 : collé au contenu (barres→281 + arm→280 + label~50 + marge8)
  const startX    = 4;
  const barWidths = [93, 125, 157, 186, 217, 248, 277];
  const slotH     = 43;
  const normalH   = 31;
  const activeH   = 43;
  const armEndX   = 280;

  let bars = "";
  for (let i = 0; i < 7; i++) {
    const L      = LETTERS[i];
    const isAct  = i === ai;
    const slotY  = 24 + i * slotH;
    const h      = isAct ? activeH : normalH;
    const yTop   = slotY + (slotH - h) / 2;
    const yMid   = yTop + h / 2;
    const yBot   = yTop + h;
    const endX   = startX + barWidths[i];
    const r      = h / 2;
    const d      = `M ${startX},${yTop} L ${endX},${yTop} A ${r},${r},0,0,1,${endX},${yBot} L ${startX},${yBot} Z`;
    const fSize  = isAct ? 26 : 11;

    bars += `<path d="${d}" fill="${CLIMATE_FILL[L]}"${isAct ? ` stroke="black" stroke-width="3"` : ""}/>` ;
    bars += `<text x="${startX + 12}" y="${yMid}" font-family="Arial,Helvetica,sans-serif" font-size="${fSize}" font-weight="${isAct ? 700 : 600}" fill="${CLIMATE_TEXT[L]}" dominant-baseline="central">${L}</text>`;
    if (isAct) {
      bars += `<line x1="${endX + r}" y1="${yMid}" x2="${armEndX}" y2="${yMid}" stroke="${CLIMATE_FILL[L]}" stroke-width="1.5"/>`;
    }
  }

  const armY        = ai >= 0 ? 24 + ai * slotH + slotH / 2 : 24 + 3 * slotH + slotH / 2;
  const valueLine    = climateValue ? esc(climateValue) + " kg CO\u2082" : "kg CO\u2082";
  const unitLine     = "m\xB2/an";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 365 360" preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%;display:block;">
  <text x="4" y="16" font-family="Arial,Helvetica,sans-serif" font-size="11" font-weight="600" fill="#6AADCE">Peu d&#x2019;émissions de CO&#x2082;</text>
  ${bars}
  <text x="${armEndX + 5}" y="${armY - 5}" font-family="Arial,Helvetica,sans-serif" font-size="9" font-weight="600" fill="#1A1A1A">${valueLine}</text>
  <text x="${armEndX + 5}" y="${armY + 7}" font-family="Arial,Helvetica,sans-serif" font-size="8" fill="#555">${unitLine}</text>
  <text x="4" y="354" font-family="Arial,Helvetica,sans-serif" font-size="10.5" font-weight="700" fill="#1A1A1A">Émissions de CO&#x2082; très importantes</text>
</svg>`;
}


// ─── Renderer principal ────────────────────────────────────────────────────────

/** Clés listing fixes utilisées par tous les blocs DPE */
export const DPE_FIXED_KEYS = {
  energyNote:   "dpe_note",
  energyValue:  "dpe_valeur",
  climateNote:  "ges_note",
  climateValue: "ges_valeur",
} as const;

export async function renderDPEBlock(
  block: DPEBlock,
  listing: ListingData
): Promise<string> {
  const base = blockBaseStyle(block);

  const energyLetter  = String(listing[DPE_FIXED_KEYS.energyNote]   ?? "");
  const energyValue   = String(listing[DPE_FIXED_KEYS.energyValue]  ?? "");
  const climateLetter = String(listing[DPE_FIXED_KEYS.climateNote]  ?? "");
  const climateValue  = String(listing[DPE_FIXED_KEYS.climateValue] ?? "");

  const variant = block.variant ?? "energy";
  const svg = variant === "climate"
    ? buildClimateSvg(climateLetter, climateValue)
    : buildEnergySvg(energyLetter, energyValue, climateValue);

  return `<div class="block" style="${base}overflow:hidden;">${svg}</div>`;
}
