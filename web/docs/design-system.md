# Toolbox Immo — Design System

> Document vivant. Mis à jour à chaque commit du chantier `feature/ui-boost`.
> Plan complet : `/Users/mathis/.claude/plans/ui-boost-plan.md`.
> Playground : `/playground` (gated par `NEXT_PUBLIC_DEV_PLAYGROUND=1`).

## Direction artistique

Inspirations : **Vercel** + **Excalidraw**. Épuré, classe, pro.

**Principes** :

- Monochrome dominant (noir, blancs, gris), 3 accents sémantiques uniquement (succès, danger, info).
- Hiérarchie par espacement + poids typographique, pas par bordures ou couleurs.
- Lignes nettes 1px, border-radius 4-6px (8-10px pour cards / modals).
- Élévation discrète : 1 niveau d'ombre subtil pour les overlays, 0 ombre pour le reste.
- Animations sobres : easing `cubic-bezier(0.16, 1, 0.3, 1)`, 150-250ms, opacity / scale > slide, jamais de bounce.
- Beaucoup de whitespace. Mieux vaut un écran qui respire qu'un écran qui en met plein la vue.

## Tokens

Définis dans `web/src/app/globals.css` (Tailwind v4 `@theme inline`). Visualisation live sur `/playground/tokens`.

### Palette monochrome

Échelle Tailwind `gray-*` standard. Foreground principal `gray-950` (`#0a0a0a`), background `white`.

| Usage | Token classes |
|---|---|
| Fond principal | `bg-white` |
| Fond subtle / hover discret | `bg-gray-50` |
| Skeletons / badges neutres | `bg-gray-100` |
| Bordures défaut | `border-gray-200` |
| Bordures hover / actives | `border-gray-300` |
| Texte muted / placeholder | `text-gray-400` |
| Icônes secondaires | `text-gray-500` |
| Texte secondaire | `text-gray-600` |
| Labels forts | `text-gray-700` |
| Texte primaire / titres | `text-gray-950` |

### Accents sémantiques

Trois familles uniquement. Tout signal coloré doit tomber dans l'une des trois.

| Famille | 50 | 100 | 600 | 700 | Usage principal |
|---|---|---|---|---|---|
| `success` | `#f0fdf4` | `#dcfce7` | `#16a34a` | `#15803d` | Validations, mark-published, statuts OK |
| `danger`  | `#fef2f2` | `#fee2e2` | `#dc2626` | `#b91c1c` | Suppression, erreurs, refus |
| `info`    | `#eff6ff` | `#dbeafe` | `#2563eb` | `#1d4ed8` | Annotations neutres, hints, état programmé |

Utilisation : `bg-success-100 text-success-700` pour un badge soft, `bg-success-600 text-white` pour un bouton plein, etc.

### Primary gradient

L'action principale courante du design system utilise un **gradient Instagram-style** diagonale orange → rose magenta → violet. C'est la couleur signature de `Button variant="primary"` et `ButtonIcon primary`. Donne le "peps" qui distingue le bouton primaire du noir flat sans rompre le monochrome global de l'app (le gradient est porté par le seul Button primary).

| Token | Valeur | Usage |
|---|---|---|
| `--gradient-primary` | `linear-gradient(135deg, #fcaf45, #e1306c, #833ab4)` | Background du Button primary |
| `--gradient-primary-hover` | Version foncée | Hover state |
| `--shadow-glow-primary` | rose/violet à 12-18% | Halo de focus / repos sur Button primary |
| `--shadow-glow-primary-strong` | idem renforcé | Halo au hover |

**Hiérarchie d'usage** :
- `primary` (gradient) : action principale standard de chaque page / formulaire / panneau. Le défaut.
- `brand` (orange flat) : ultra chirurgical — 2-3 moments forts dans toute l'app (S'inscrire, Marquer publié, Démarrer onboarding).
- Le reste : `secondary`, `ghost`, `danger` en mono.

### Brand color

Une couleur signature en plus des accents sémantiques — orange-corail mature, le peps "agence créative" sans tomber dans le pop kid. Réservée aux CTA principaux, liens narratifs et highlights marketing. **Jamais** utilisée pour communiquer un statut (succès / erreur / info), **jamais** pour la sélection d'un élément UI (item de nav actif, slot sélectionné — cf. "États UI" plus bas).

| Stop | Hex | Usage |
|---|---|---|
| `brand-50`  | `#fff4ed` | Wash très subtil (hero bg) |
| `brand-100` | `#ffe3d0` | Halo doux |
| `brand-500` | `#ff7a3c` | Badge "new", icône signature |
| `brand-600` | `#ff5a1f` | **Fonds** : CTA primary (`bg-brand-600 text-white`) — contraste OK sur blanc |
| `brand-700` | `#e04210` | **Textes** : eyebrow, lien narratif, headline brand sur fond clair — passe AA |
| `brand-900` | `#9c2b06` | Hover state du texte brand |

**Accessibilité texte critique** : `brand-600` sur blanc = ratio ~3.4 (sous AA pour texte petit). Utiliser `brand-700` dès qu'on met du texte brand sur fond clair (ratio ~5.2, AA ✓).

### Effets

- `shadow-overlay` / `shadow-modal` — élévation sobre des overlays.
- `shadow-card-elevated` — surfaces marketing (cards photos, hero).
- `shadow-glow-brand` / `shadow-glow-brand-strong` — halo coloré orange au repos / hover sur les CTA brand. C'est ce qui donne le "peps".
- `--gradient-hero` — wash orange-corail très léger pour les sections de mise en avant.
- `--gradient-subtle` — gradient blanc → gray-50 pour les sections secondaires.
- `--texture-grain` — noise SVG très subtil pour les hero. Toujours `opacity ≤ 0.6` avec `mix-blend-multiply` pour ne pas dégrader la lecture. Donne la "matière magazine" qui sort du tech pur.

Accès via `style={{ background: "var(--gradient-hero)" }}` ou `className="bg-[var(--gradient-hero)]"`.

### États UI

Patterns à appliquer uniformément. La cohérence des états est ce qui distingue un design system tenu d'un patchwork.

| État | Pattern | Token / classe |
|---|---|---|
| **Focus** | Anneau brand 3px à 22% opacité | `focus-ring` (utility globale) |
| **Focus erreur** | Anneau danger 3px | `focus-ring-danger` |
| **Sélection (item de nav, onglet, slot)** | **Mono dark** : `bg-gray-950 text-white` ou `border-b-gray-950` | — pas de classe dédiée |
| **Hover discret (item de liste)** | `bg-gray-100` | — |
| **Hover lift (cards interactives)** | `hover:-translate-y-0.5 hover:shadow-[var(--shadow-card-elevated)] hover:border-gray-300` | — |
| **Désactivé** | `opacity-50 cursor-not-allowed` (button) ou `bg-gray-50 text-gray-400 cursor-not-allowed` (input) | — |
| **Chargement** | Spinner inline `<span class="h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />` + `opacity-70 cursor-wait` | — |
| **Erreur (input)** | `border-danger-600` + `focus-ring-danger` | — |

**Règle critique** : le **brand** n'est PAS utilisé pour la sélection. Une nav, une liste, un onglet sélectionné = **mono dark** (`gray-950`). Sinon l'app vire orange-pop et le brand perd sa rareté.

### Couleurs auxiliaires (rôles, phases)

Le système a deux familles de couleurs **en plus** du brand et des accents sémantiques. Elles sont **gérées hors design system** (Tailwind par défaut, dans `web/src/lib/slots/phase.ts` et `web/src/types/calendar.ts`). Ne pas les toucher pendant la migration UI.

| Famille | Source | Palette utilisée |
|---|---|---|
| **Phases publication** | `PHASE_COLORS` dans `lib/slots/phase.ts` | gray (planned), yellow (shooting), stone (production), amber (admin_review), indigo (cm_review), teal (publishing), green (published), gray (terminated) |
| **Rôles (badges)** | `OWNER_BADGE_CLS` dans `lib/slots/statusLabels.ts` | amber (Vidéaste), orange (Monteur), indigo (CM), violet (Admin) |
| **Avatars rôles SlotCard** | `ROLE_AVATAR_CLS` dans `calendar/SlotCard.tsx` | amber (V), orange (M), indigo (C) |

Ces couleurs **signifient** quelque chose (qui c'est, où on en est). Le brand ne les touche pas. La migration UI ne les modifie pas non plus, sauf en cas de clash visuel explicite (cas `production: orange` repeint en `stone` car conflit avec brand).

### Radius autorisés

- Tokens du DS : `rounded-sm` (4px) · `rounded-md` (6px) · `rounded-lg` (8px) · `rounded-xl` (10px)
- Tailwind par défaut autorisés en plus : `rounded-2xl` (16px, modals / hero cards), `rounded-full` (pills, dots, avatars)
- Privilégier l'échelle DS pour les composants UI courants. `rounded-2xl` réservé aux surfaces "élevées" (modals, hero), `rounded-full` aux éléments circulaires.

### Décors signature

Quatre décors SVG (`web/src/components/ui/decor/HandDrawn.tsx`), regroupés en 2 paires d'usage. La personnalité passe d'abord par les typos (Serif italic + Caveat hand) ; les décors viennent ponctuer chirurgicalement.

**Décors d'UI signature** (utilisables dans toutes les zones marketing-adjacentes) :

| Décor | Usage |
|---|---|
| `<HandDrawn.Sparkle />` | Préfixe d'eyebrow, badge "Nouveau", accent dans avatar agence. Twinkle 4-pointes filled. |
| `<HandDrawn.Arrow />` | Flèche signature des liens narratifs. Animation : `transition-transform group-hover:translate-x-0.5`. |

**Décors éditoriaux** (strictement réservés au contexte hero / testimonial / pull quote — jamais dans les listes, panneaux, fiches) :

| Décor | Usage |
|---|---|
| `<HandDrawn.Underline />` | Souligné subtil sous un mot clé d'une citation ou d'un hero serif italic. Une seule courbe douce, jamais un zigzag. |
| `<HandDrawn.WavyRule />` | Trait séparateur fin entre une citation et sa signature, ou divider éditorial discret. |

Tous utilisent `currentColor`. Pas de bibliothèque externe (Rough.js) — SVG path statiques.

**Doctrine de sobriété** : un Sparkle par section, un Underline par citation. Si tu dois en empiler 3 pour faire passer un message, c'est que la typo (serif italic + hand) ne fait pas son boulot — refonds la composition plutôt que d'empiler des décors.

Décors envisagés puis écartés : HighlightCircle (trop scolaire), Bracket (trop verbeux). Si un cas d'usage légitime apparaît plus tard, on les ressort.

### Typographie — 3 registres, discipline stricte

Toolbox a **3 familles typographiques**, chacune un rôle précis. Ne jamais en faire dériver l'usage hors de son registre.

| Registre | Famille | Utility | Quand | Où ne JAMAIS l'utiliser |
|---|---|---|---|---|
| **Tech functional** | Geist Sans / Mono | `font-sans` / `font-mono` | 90% de l'app : dashboards, panneaux, fiches, formulaires, tableaux, labels, raccourcis clavier, IDs | — |
| **Marketing editorial** | Instrument Serif italic | `font-serif italic` | Hero titles + pull quotes — landing pages futures et 1-2 heros marquants dans l'app | Body texte, UI courante, labels |
| **Signature handmade** | Caveat | `font-hand` | Logo "Toolbox", badges "Astuce", eyebrow décoratif, empty states friendly, légendes de schémas | Body texte, titres de page, UI fonctionnelle (panneaux, fiches, formulaires) |

**Doctrine** : la cohérence ne signifie pas l'uniformité. Geist sert l'efficacité, Serif sert l'éditorial, Caveat sert la personnalité. Mixer les 3 dans le même écran = sympa pour un hero, banni pour un panneau.

Échelle Tailwind par défaut (`text-xs` à `text-5xl`). Hero serif : `text-4xl` ou `text-5xl` + `tracking-tight leading-[1.05]`. Hand : `text-xl` à `text-3xl`, jamais en dessous (illisible).

### Espacement

Échelle Tailwind par défaut (4px base). Privilégier `4 / 6 / 8 / 10 / 12 / 16` pour cohérence.

### Ombres

| Token | Valeur | Usage |
|---|---|---|
| `shadow-overlay` | `0 1px 0 rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.06)` | Dropdowns, popovers |
| `shadow-modal` | `0 8px 32px rgba(0,0,0,0.08)` | Modals |

### Animations

```css
--ease-out-soft: cubic-bezier(0.16, 1, 0.3, 1);
--duration-fast: 150ms;
--duration-base: 200ms;
--duration-slow: 350ms;
```

Privilégier opacity / scale. Transitions sur `colors`, `opacity`, `transform`. Pas de slide.

## Primitives

Existantes (`web/src/components/ui/`) :

- [ ] `Button` — à aligner sur les nouveaux tokens
- [ ] `Input` — idem
- [ ] `Textarea` — idem
- [ ] `FormField` — idem
- [ ] `EmptyState` — idem
- [ ] `ConfirmDialog` — idem (focus trap, ESC)
- [ ] `DeleteButton` — idem
- [ ] `Toast` — idem

À ajouter en Phase 1 :

- [ ] `Tooltip`
- [ ] `DropdownMenu`
- [ ] `Tabs`
- [ ] `Sidebar` / `NavRail`
- [ ] `Card`
- [ ] `Badge`
- [ ] `Skeleton`
- [ ] `Switch`
- [ ] `Kbd` (raccourci clavier, déjà inline dans PropertiesPanel mais à extraire)

## Principes UX

### Hot / Cold

Les workflows fréquents (CM marque publié, monteur upload version, voir slots du jour) doivent être en avant-plan, accessibles en 1 click depuis l'entrée principale du rôle.

Les workflows rares (configurer un pattern, créer un caption preset, gérer des accès) sont cachés derrière un menu, une section "Avancé" ou enfouis dans `/admin/*`.

L'audit complet hot/cold sera produit en **Phase 2** via l'agent `ux-auditor`.

### Cohérence avant créativité

Un langage visuel uniformément appliqué bat 3 touches créatives isolées. Si tu hésites entre 2 options pour un nouveau composant, choisis celle qui ressemble le plus à ce qui existe déjà dans le design system, même si elle est moins "wahou".

### Interdictions de scope

Cette PR ne doit toucher **que** :

- `web/src/components/`
- `web/src/app/(app|admin|dev)/*/page.tsx` et `layout.tsx`
- `web/src/styles/`
- `web/tailwind.config.ts`
- `web/docs/design-system.md`

Interdiction de modifier :

- `web/src/lib/`
- `web/src/app/api/`
- `web/prisma/`

Cette règle est enforced (en opt-in) par le hook pre-commit dans `web/scripts/scope-guard.sh`.
Active la garde pendant ta session : `touch .ui-boost-active` à la racine.
Désactive quand tu veux commit hors scope : `rm .ui-boost-active`.

## État du chantier

- [x] Phase 0 : setup worktree + playground + skeleton doc
- [ ] Phase 1 : tokens + primitives
- [ ] GATE 1 : validation visuelle dans `/playground`
- [ ] Phase 2 : audit hot/cold
- [ ] Phase 3 : refonte coquille (AppNav, layout)
- [ ] Phase 4 : surfaces hot (home, fiche, builder)
- [ ] Phase 5 : surfaces cold (calendar, admin)
- [ ] Phase 6 : polish final (micro-interactions)
- [ ] GATE 2 : test live
- [ ] Phase 7 : rebase + merge
