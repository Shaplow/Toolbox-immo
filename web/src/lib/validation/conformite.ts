import { ListingData, LEGAL_MENTIONS } from "@/types/listing";

export interface ConformiteError {
  field: string;
  message: string;
}

export interface ConformiteResult {
  valid: boolean;
  errors: ConformiteError[];
  enrichedListing: ListingData;
}

/** Champs obligatoires pour une annonce vitrine conforme */
const REQUIRED_FIELDS: Array<{
  key: string;
  label: string;
}> = [
  { key: "price_eur",               label: "Prix" },
  { key: "fees_note",               label: "Mention honoraires" },
  { key: "dpe_energy_letter",       label: "Classe énergie DPE" },
  { key: "dpe_climate_letter",      label: "Classe climat DPE" },
  { key: "energy_cost_min",         label: "Coût énergétique min" },
  { key: "energy_cost_max",         label: "Coût énergétique max" },
  { key: "energy_cost_year_index",  label: "Année index énergie" },
  { key: "agency_siren",            label: "SIREN agence" },
];

/**
 * Valide la conformité légale d'une annonce vitrine et enrichit
 * automatiquement les mentions manquantes (Géorisques, mention F/G).
 */
export function validateConformite(listing: ListingData): ConformiteResult {
  const errors: ConformiteError[] = [];
  const enriched = { ...listing };

  // 1. Vérification des champs obligatoires
  for (const { key, label } of REQUIRED_FIELDS) {
    const val = listing[key];
    if (val === undefined || val === null || val === "") {
      errors.push({ field: key, message: `${label} est obligatoire` });
    }
  }

  // 2. Auto-injection mention Géorisques si absente
  if (!enriched.georisques_mention) {
    enriched.georisques_mention = LEGAL_MENTIONS.GEORISQUES;
  }

  // 3. Auto-ajout mention F/G si classe énergie = F ou G
  if (
    listing.dpe_energy_letter === "F" ||
    listing.dpe_energy_letter === "G"
  ) {
    enriched.fg_warning = LEGAL_MENTIONS.FG_WARNING;
  }

  return {
    valid: errors.length === 0,
    errors,
    enrichedListing: enriched,
  };
}
