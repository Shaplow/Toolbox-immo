/**
 * Le canal « ouvre cette section et amène-moi dessus ».
 *
 * Émis par la chaîne d'étapes et le bandeau de prochaine action, écouté par
 * `Section` et `CollapsibleSection`. C'est ce mécanisme qui donne à la fiche
 * publication sa sensation de page pilotable : cliquer une étape déplie la
 * section correspondante et y défile.
 *
 * Le nom vit ici, en constante, plutôt qu'en littéral recopié dans cinq
 * fichiers : un renommage qui en oublie un ne casse RIEN visiblement — le clic
 * cesse simplement de déplier, sans erreur. C'est le genre de divergence
 * silencieuse qu'on ne découvre que des semaines plus tard.
 *
 * `fiche:` et non `pub:` parce que la fiche métaobjet va s'en servir aussi :
 * le mécanisme n'a jamais eu quoi que ce soit de spécifique aux publications.
 */

export const OPEN_SECTION_EVENT = "fiche:open-section";

export interface OpenSectionDetail {
  sectionId: string;
}

/**
 * Demande l'ouverture d'une section, puis le défilement vers elle.
 *
 * Le délai laisse le dépli se faire avant de mesurer la position : sans lui, on
 * défile vers une section encore repliée et on atterrit à côté.
 */
export function emitOpenSection(sectionId: string, scrollDelayMs = 50): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<OpenSectionDetail>(OPEN_SECTION_EVENT, { detail: { sectionId } }),
  );
  setTimeout(() => {
    document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, scrollDelayMs);
}
