/**
 * Comparaison de libellés en ordre NATUREL : « RAUTO 2 » avant « RAUTO 10 ».
 *
 * L'ordre alphabétique brut devient illisible dès qu'une liste porte des
 * numéros — et c'est le cas de tout ce qui se nomme par série dans ce produit :
 * les dossiers d'une bibliothèque, les recettes d'un catalogue. Troisième
 * occurrence du même `localeCompare` : extraite pour qu'il n'y en ait pas une
 * quatrième qui oublie `numeric`.
 */
export function compareNatural(a: string, b: string): number {
  return a.localeCompare(b, "fr", { numeric: true });
}
