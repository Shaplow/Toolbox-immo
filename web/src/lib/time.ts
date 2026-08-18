/**
 * Helpers de timecode partagés par les éditeurs de trim (TrimPlayer,
 * AutocutReviewCard, MediaAssetEditModal, MediaBatchAutocutPanel).
 *
 * Avant ce fichier, `clamp`/`round2`/`fmt` étaient redéfinis dans chacun de
 * ces composants — et `fmt` avait divergé en 3 variantes incompatibles
 * (avec/sans branche heures, avec/sans centisecondes), ce qui produisait un
 * affichage faux au-delà de 60 min dans certaines surfaces.
 */

/** Contraint `v` dans [lo, hi]. */
export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Arrondit à 2 décimales (précision seconde utilisée pour les trims). */
export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Formatte une durée en timecode lisible : `M:SS[.cc]`, ou `H:MM:SS[.cc]`
 * au-delà d'une heure.
 *
 * La branche heures est nécessaire : sans elle, un rush de plus de 60 min
 * affiche un nombre de minutes à 3 chiffres au lieu de basculer en heures
 * (bug réel observé dans l'ancienne variante de AutocutReviewCard).
 */
export function formatTimecode(
  seconds: number | null | undefined,
  options: { centiseconds?: boolean } = {},
): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "";
  const { centiseconds = true } = options;
  const abs = Math.abs(seconds);
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const sec = Math.floor(abs % 60);
  const base = h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
  if (!centiseconds) return base;
  const cs = Math.round((abs % 1) * 100).toString().padStart(2, "0");
  return `${base}.${cs}`;
}
