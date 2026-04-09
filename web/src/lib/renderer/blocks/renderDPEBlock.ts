import type { DPEBlock, SchemaField } from "@/types/template";
import type { ListingData } from "@/types/listing";
import { buildDpeSvg } from "@/lib/dpeSvg";
import { blockBaseStyle } from "../styleUtils";


// ─── Renderer principal ────────────────────────────────────────────────────────

/** Clés listing fixes utilisées par tous les blocs DPE */
export const DPE_FIXED_KEYS = {
  energyNote:   "dpe_note",
  energyValue:  "dpe_valeur",
  climateNote:  "ges_note",
  climateValue: "ges_valeur",
} as const;

const DPE_LETTERS = ["A", "B", "C", "D", "E", "F", "G"];

export const DPE_AUTO_FIELDS: SchemaField[] = [
  { key: DPE_FIXED_KEYS.energyNote,   label: "Classe energie (DPE)",         type: "select", required: true,  options: DPE_LETTERS, description: "Note de performance energetique" },
  { key: DPE_FIXED_KEYS.energyValue,  label: "Consommation (kWh/m2/an)",      type: "number", required: true,  placeholder: "180",   description: "Consommation d'energie primaire" },
  { key: DPE_FIXED_KEYS.climateNote,  label: "Classe GES (emissions CO2)",    type: "select", required: true,  options: DPE_LETTERS, description: "Note d'emissions de gaz a effet de serre" },
  { key: DPE_FIXED_KEYS.climateValue, label: "Emissions CO2 (kg CO2/m2/an)", type: "number", required: false, placeholder: "12",    description: "Emissions de CO2 du logement" },
];

export async function renderDPEBlock(
  block: DPEBlock,
  listing: ListingData
): Promise<string> {
  const base = blockBaseStyle(block);

  const energyLetter  = String(listing[DPE_FIXED_KEYS.energyNote]   ?? "");
  const energyValue   = String(listing[DPE_FIXED_KEYS.energyValue]  ?? "");
  const climateLetter = String(listing[DPE_FIXED_KEYS.climateNote]  ?? "");
  const climateValue  = String(listing[DPE_FIXED_KEYS.climateValue] ?? "");

  const svg = buildDpeSvg({
    variant: block.variant ?? "energy",
    energyLetter,
    energyValue,
    climateLetter,
    climateValue,
    showFrame: block.showFrame,
    frameColor: block.frameColor,
    showBackground: block.showBackground,
    backgroundColor: block.backgroundColor,
  });

  return `<div class="block" style="${base}overflow:hidden;${block.style.opacity !== undefined ? `opacity:${block.style.opacity};` : ""}">${svg}</div>`;
}
