export type DPELetter = "A" | "B" | "C" | "D" | "E" | "F" | "G";

export interface ListingData {
  // ─── Bien ──────────────────────────────────────────────────────────────────
  title: string;
  address_short: string; // ex: "Neuilly-sur-Seine, 92"

  // ─── Prix ──────────────────────────────────────────────────────────────────
  price_eur: number;
  fees_note: string; // ex: "Honoraires charge acquéreur : 3,5%"

  // ─── Images ────────────────────────────────────────────────────────────────
  hero_image?: string; // URL ou chemin
  logo?: string;
  dpe_image?: string; // image DPE officielle (optionnel)

  // ─── Contact / agence ──────────────────────────────────────────────────────
  agency_name: string;
  agency_siren: string;
  phone?: string;
  website?: string;
  qr_url?: string;

  // ─── DPE ───────────────────────────────────────────────────────────────────
  dpe_energy_letter: DPELetter;
  dpe_climate_letter: DPELetter;
  energy_cost_min: number; // €/an
  energy_cost_max: number; // €/an
  energy_cost_year_index: number; // ex: 2021

  // ─── Copropriété (optionnel) ───────────────────────────────────────────────
  is_copro?: boolean;
  lots_count?: number;
  annual_charges?: number; // €/an
  procedure_in_progress?: boolean;

  // ─── Champs supplémentaires libres (custom fields du template schema) ───────
  [key: string]: unknown;
}

export const LEGAL_MENTIONS = {
  GEORISQUES:
    "Les informations sur les risques auxquels ce bien est exposé sont disponibles sur le site Géorisques : www.georisques.gouv.fr",
  FG_WARNING:
    "Logement à consommation énergétique excessive. Selon la réglementation actuelle, sa consommation en énergie primaire est supérieure à 330 kWh/m²/an.",
} as const;

export const DPE_COLORS: Record<string, string> = {
  A: "#009900",
  B: "#33CC33",
  C: "#99CC00",
  D: "#FFCC00",
  E: "#FF9900",
  F: "#FF3300",
  G: "#CC0000",
};

/** Formate le prix en français */
export function formatPrice(price: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(price);
}
