/**
 * Résumé d'un `Listing.jsonData` pour « Mes générations » : de quoi reconnaître
 * une génération (le bien, pas le template) et la retrouver par la recherche.
 *
 * Sans ce résumé, toutes les affiches d'un même template portent le même titre
 * (« Vitrine · Bonjour Oscar ») et un client qui veut reprendre une ancienne
 * affiche pour en changer le bandeau ne la retrouve pas.
 *
 * Heuristique sur les clés du formulaire, pas sur le schéma du template : elle
 * marche sur tout l'historique, sans charger les templates ni migrer quoi que
 * ce soit. Une variable « Référence mandat » ajoutée au template passe en tête.
 */
import { stripProvenance } from "@/lib/generate/provenance";
import { formatConfiguredNumber } from "@/lib/numberFormatting";

export interface ListingSummary {
  /** Libellé court du bien (« 12 rue de la Paix · 11e · 450 000 € »), ou null. */
  summary: string | null;
  /** Toutes les valeurs saisies, hors médias, pour la recherche plein texte. */
  searchText: string;
}

/**
 * Familles de clés, de la plus parlante à la moins parlante. On compare des
 * mots entiers de la clé (`reference_mandat` → `reference`, `mandat`) : une
 * sous-chaîne attraperait `nombre_pieces` pour « nom » ou `subtitle` pour « title ».
 */
const SUMMARY_KEY_GROUPS: ReadonlySet<string>[] = [
  new Set(["mandat", "ref", "reference"]),
  new Set(["titre", "title"]),
  new Set(["adresse", "address", "rue", "street", "voie"]),
  new Set(["ville", "city", "commune", "quartier", "arrondissement", "cp", "postal"]),
  new Set(["prix", "price"]),
];

const PRICE_TOKENS: ReadonlySet<string> = new Set(["prix", "price"]);

const MAX_SUMMARY_PARTS = 3;
const FALLBACK_PARTS = 2;
/** Au-delà, la valeur est un texte (description…) : cherchable, pas un libellé. */
const MAX_SUMMARY_VALUE_LENGTH = 60;

/** URL de média (R2, upload local, data/blob) : ni libellé ni texte à chercher. */
const MEDIA_VALUE = /^(https?:|\/|data:|blob:)/i;
/** Un nombre seul (« 450000 », « 450 000 », « 450000,50 ») — rien d'autre. */
const BARE_NUMBER = /^-?\d[\d\s  .,]*$/;

function keyTokens(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function textValue(value: unknown): string | null {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || MEDIA_VALUE.test(trimmed)) return null;
  return trimmed;
}

/** « 450000 » → « 450 000 € » ; une saisie libre (« 450 000 € FAI ») reste telle quelle. */
function formatPrice(value: string): string {
  if (!BARE_NUMBER.test(value)) return value;
  const formatted = formatConfiguredNumber(value, { formatThousands: true });
  return formatted ? `${formatted} €` : value;
}

export function summarizeListingValues(jsonData: string): ListingSummary {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonData);
  } catch {
    return { summary: null, searchText: "" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { summary: null, searchText: "" };
  }

  const entries: { tokens: string[]; raw: string; text: string }[] = [];
  for (const [key, value] of Object.entries(stripProvenance(parsed as Record<string, unknown>))) {
    if (key.startsWith("__")) continue;
    const raw = textValue(value);
    if (raw === null) continue;
    const tokens = keyTokens(key);
    const text = tokens.some((t) => PRICE_TOKENS.has(t)) ? formatPrice(raw) : raw;
    entries.push({ tokens, raw, text });
  }

  // Le prix brut ET formaté : « 450000 » comme « 450 000 » doivent trouver l'affiche.
  const searchParts = new Set<string>();
  for (const { raw, text } of entries) {
    searchParts.add(raw);
    searchParts.add(text);
  }

  const short = entries.filter((e) => e.text.length <= MAX_SUMMARY_VALUE_LENGTH);
  const picked: string[] = [];
  for (const group of SUMMARY_KEY_GROUPS) {
    for (const entry of short) {
      if (picked.length >= MAX_SUMMARY_PARTS) break;
      if (picked.includes(entry.text)) continue;
      if (entry.tokens.some((t) => group.has(t))) picked.push(entry.text);
    }
  }
  if (picked.length === 0) {
    for (const entry of short.slice(0, FALLBACK_PARTS)) picked.push(entry.text);
  }

  return {
    summary: picked.length > 0 ? picked.join(" · ") : null,
    searchText: [...searchParts].join(" "),
  };
}
