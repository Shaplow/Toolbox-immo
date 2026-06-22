# Recette builder — Overlay titre immobilier (ville / rue / surface)

**Cible** : un overlay vidéo qui empile une ville/arrondissement, un nom de rue en gros
(tenant sur **1 ou 2 lignes** selon sa longueur), puis une ligne du bas avec la surface m²,
le tout avec le **haut figé** et la surface qui colle au titre sans trou.

> Cette recette n'utilise que des réglages du builder (groupe auto-layout). Le moteur de
> layout est partagé builder ↔ HTML ↔ vidéo (`web/src/lib/groupLayout.ts` +
> `web/src/lib/renderer/buildHTML.ts`), donc le rendu final est identique à l'aperçu.

## Étapes

1. **Créer les blocs** : un bloc texte ville (« Paris 8 »), un bloc texte titre/rue
   (« JOURDAIN »), un bloc surface (« 55 m² »).
2. **Titre/rue** — dans les propriétés du bloc texte :
   - `shrink-to-fit` activé + une **taille mini** (`minFontSize`),
   - **lignes max = 2** (`maxLines`) : le titre wrappe sur 2 lignes au lieu de rétrécir
     indéfiniment. Un cadre assez large laisse « PETITE CARRIÈRE » passer sur 2 lignes
     tandis que « JOURDAIN » reste sur 1.
3. **Grouper** les blocs et passer le groupe en **Disposition = Colonne**.
4. **Justifier = Haut** (`justify: "start"`). C'est le point clé : le haut du groupe (la ville)
   est **figé**, et le bas « respire » quand le titre passe de 1 à 2 lignes.
   - `Centre` (défaut) recentrerait tout le bloc → le haut **et** le bas bougent.
   - `Bas` figerait au contraire la surface et ferait monter le titre.
5. **Activer « Hauteur réelle du texte »** (toggle du groupe, = `sizeToContent`).
   Sans ça, l'auto-layout mesure la hauteur du **cadre figé** du bloc titre, donc la surface
   est espacée du cadre (trou en 1 ligne). Avec ça, la surface colle à la **hauteur réelle**
   du titre rendu — 1 ligne ⇒ collée, 2 lignes ⇒ descend pile d'une ligne.

## Pourquoi « Hauteur réelle du texte » est nécessaire

Pour un bloc texte **sans cartouche/fond**, la mesure d'auto-layout retombe historiquement sur
la hauteur du cadre `block.h` (figée), pas sur la hauteur des glyphes wrappés. Le flag
`sizeToContent` (par groupe, défaut OFF) fait mesurer `.block-text-content` à la place — la
hauteur effectivement rendue (après shrink-to-fit + wrap). C'est ce qui rend l'espacement
« titre → surface » dynamique au lieu de réservé.

Réf. : `GroupLayoutConfig.sizeToContent` (`web/src/types/template.ts`),
mesure `web/src/components/builder/Canvas.tsx` + parité `getEffectiveSize`
(`web/src/lib/renderer/buildHTML.ts`).

## Anatomie de l'ancrage (`justify` en mode colonne)

| Réglage | Effet quand le titre passe 1 → 2 lignes |
|---|---|
| `Haut` (`start`) | Ville figée en haut ; titre grandit vers le bas ; surface suit. |
| `Centre` (`center`) | Bloc recentré : haut **et** bas bougent. |
| `Bas` (`end`) | Surface figée en bas ; titre + ville montent. |
