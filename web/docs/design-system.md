# Toolbox Immo — Design System

> SaaS d'équipe pour agence social media. Sobre, dense, fonctionnel, avec une identité reconnaissable au détail près. Doctrine figée — toute évolution doit la respecter ou la modifier explicitement ici.
> Plan vivant : `/Users/mathis/.claude/plans/wobbly-wishing-eich.md` (Liquid Glass). Plan v1 archive : `/Users/mathis/.claude/plans/ui-boost-plan.md`. Playground : `/playground` (gated `NEXT_PUBLIC_DEV_PLAYGROUND=1`).

## Liquid Glass — extension v2

**Statut** : en cours de déploiement (Phase 1 — tokens). La doctrine v1 ci-dessous reste **ossature structurelle** valide. Liquid Glass + palette Coastal Studio s'ajoutent comme **matière de surface opt-in**.

### Philosophie

- **Glass = matière flottante.** Surfaces qui méritent d'être perçues comme posées au-dessus du contenu : popovers, modals, headers sticky, drawers, FAB, panels d'overview. **Pas** en grille dense (perf Safari iPad), **pas** en CTA (verre = passif), **pas** sur fond variable sans scrim opaque (contraste WCAG).
- **Coastal Studio = palette pastel orchestrée.** 4 teintes (peach, sage, sky, rose-dust) à saturation basse, utilisées en tinted backgrounds (`bg-peach-50/40`), en accents de statut doux, et en gradients washes. **Jamais** en CTA, **jamais** en focus ring.
- **Brand orange `#FF5A1F`** chirurgical conservé exactement aux mêmes 2 spots (logo + dot notif) — devient encore plus signature dans une UI pastel.
- **Extension, pas remplacement.** La rigueur Linear (density, mono CTA `gray-950` flat, accents sémantiques success/danger/info pour statuts) reste l'ossature. Glass est opt-in via variants à partir de Phase 2.

### Quand utiliser glass vs solide

| Surface | Choix | Pourquoi |
|---|---|---|
| Modal, drawer, sheet | **Glass** (`surface-glass` ou variant `glass`) | Flottent au-dessus de l'app |
| Popover, dropdown, tooltip, command palette | **Glass popover** | Détail signature macOS Sequoia |
| Header sticky d'une fiche/section | **Glass faint** au scroll | Solide en haut, glass quand on s'enfonce |
| Section interne (Brief, Captions, Description sur fiche) | **Glass-soft** ou solide selon contexte | Glass-soft = wash subtil ; solide reste OK |
| Card de liste (worklist, slot calendar) | **Solide** | Densité, perf, lisibilité prime |
| CTA primary | **Solide `gray-950`** | Le CTA reste flat, immédiat, lisible |
| Builder Canvas (rendu de blocs) | **Hors scope** | Logique user-facing, pas chrome |

### Palette Coastal Studio — usage

| Teinte | Stops | Usage typique |
|---|---|---|
| **Peach** | 50 / 100 / 200 / 500 / 700 | Chaleur, statuts "à faire", tinted background warm |
| **Sage**  | 50 / 100 / 200 / 500 / 700 | Calme, statuts "ok" doux, accent switch positif |
| **Sky**   | 50 / 100 / 200 / 500 / 700 | Info, planning, programmé, sélection bloc builder |
| **Rose-dust** | 50 / 100 / 200 / 500 / 700 | Accent rare, signature, drawer override |

Classes Tailwind disponibles : `bg-peach-50`, `text-peach-700`, `border-sage-200`, etc. (générées automatiquement par Tailwind v4 depuis les tokens `@theme`).

### Tokens glass — référence

Tous dans `web/src/app/globals.css` (bloc `@theme inline`).

| Famille | Tokens | Usage |
|---|---|---|
| Surfaces | `--surface-glass-strong` (0.85α) / `medium` (0.65α) / `soft` (0.45α) / `faint` (0.25α) | Background du verre |
| Blur | `--backdrop-blur-xs` (8px) / `sm` (12px) / `md` (20px) / `lg` (32px) + `--backdrop-saturate` (140%) | `backdrop-filter` |
| Scrims | `--scrim-light` (0.65α blanc) / `dark` (0.45α noir) / `deep` (0.65α noir) | Backdrop modal/drawer |
| Shadows verrerie | `--shadow-glass-sm` / `md` / `lg` / `popover` | Élévation glass |
| Ring inset | `--ring-glass-inset` (top) / `edge` (full) / `bottom` | Détail signature verre |
| Gradients | `--gradient-peach-soft` / `sage-soft` / `sky-soft` / `frosted` / `aurora` | Washes décoratifs (jamais en CTA) |

### Classes utilitaires

Préférer ces classes à du `bg-white/80 backdrop-blur-md` ad hoc — ça centralise via tokens et garantit le ring intérieur signature.

| Classe | Composition | Quand |
|---|---|---|
| `.surface-glass` | strong + blur-md + saturate + shadow-glass-md + ring-inset | Popovers, modals, headers sticky |
| `.surface-glass-soft` | medium + blur-sm + saturate + shadow-glass-sm + ring-edge | Sections internes, panneaux secondaires |

Composer avec `bg-peach-50/40`, `bg-sage-50/40` etc. pour la version tinted.

### Risques surveillés

1. **Perf `backdrop-filter` sur Safari iPad** — limiter glass aux surfaces flottantes, pas grilles denses.
2. **Contraste WCAG sur glass au-dessus d'images user** — règle : si fond variable, ajouter scrim opaque sous le glass.
3. **Régression silencieuse sur les défauts** — Phase 2 ajoute des variants opt-in, défauts inchangés. Tests visuels avant/après sur 5 surfaces pivots (PublicationFiche, CalendarView, AppNav, HomeAdmin, AdminUsersPanel).

---

## Doctrine structurelle — en 5 phrases

> Toujours valide. Liquid Glass étend cette doctrine sans la remplacer.

1. **L'UI Toolbox = Geist Sans + monochrome + density Linear + icon-first.** Pas un seul élément de plus.
2. **Le primary CTA = `bg-gray-950` flat.** Vercel, Linear, Apple le font, on le fait. Aucun gradient, aucune couleur, aucun glow.
3. **Le brand orange `#FF5A1F` apparaît à 2 endroits dans toute l'app :** le logo Toolbox (carré orange + nom en `font-hand` Caveat) et un dot indicateur dans la nav. C'est sa rareté qui le rend mémorable.
4. **Les accents sémantiques (success / danger / info) ne sont QUE des statuts.** Jamais des CTA, jamais une couleur décorative.
5. **L'effet "wahou" vient de la rigueur, pas de la couleur.** Density Linear + transitions soignées + micro-interactions soignées + density qui fait voir 20 slots en un coup d'œil.

## Tokens UI courants

### Palette monochrome — l'ossature

Tailwind `gray-*` par défaut. `gray-950` (`#0a0a0a`) pour le texte primaire et les CTA principaux. `gray-50` pour les fonds subtle, `gray-200` pour les bordures par défaut.

### Accents sémantiques

3 familles uniquement. **Statuts**, jamais CTA, jamais décoration.

| Famille | Stops | Usage |
|---|---|---|
| `success` | 50 / 100 / 600 / 700 | Validations, mark-published, statuts OK |
| `danger`  | 50 / 100 / 600 / 700 | Suppression, erreurs, refus |
| `info`    | 50 / 100 / 600 / 700 | Annotations neutres, hints, programmé |

### Brand orange — la signature chirurgicale

`brand-50` à `brand-900` disponibles. **Mais utilisé à 2 endroits seulement dans toute l'app** :

1. **Logo Toolbox** : carré `bg-brand-600` + nom "Toolbox" en `font-hand` (Caveat). C'est l'unique endroit où Caveat et brand orange cohabitent dans l'UI courante. Pattern figé.
2. **Dot indicateur dans la nav** : petite pastille `bg-brand-600` (avec animation ping discrète pour les nouvelles notifications).

Toute autre apparition de `bg-brand-*`, `text-brand-*`, ou `font-hand` dans `app/(app|admin)/*` ou `components/(builder|calendar|publications|admin)/*` est un bug de discipline → rollback.

### Typographie UI

Deux familles, point.

- **Geist Sans** (`font-sans`) — texte UI, dashboards, panneaux, fiches, formulaires.
- **Geist Mono** (`font-mono`) — code, raccourcis clavier, IDs, valeurs hex, métadonnées.

Échelle Tailwind par défaut. Pour les titres `text-2xl+` : `tracking-tight`.

### Density Linear

Hauteurs serrées par défaut sur les composants courants :

| Composant | sm | md (default) | lg |
|---|---|---|---|
| Button | `h-7` | `h-8` | `h-9` |
| Input | — | `h-8` | — |
| ButtonIcon | `h-7 w-7` | `h-8 w-8` | — |

Font-size UI courante : 12px (badges, eyebrows), 13px (inputs, button md), 14px (button lg, body), 16px (sous-titres).

### États UI

| État | Pattern | Token / classe |
|---|---|---|
| **Focus** | Anneau mono dark 3px à 14% opacité | `focus-ring` utility |
| **Focus erreur** | Anneau danger 3px | `focus-ring-danger` |
| **Sélection / actif** | `bg-gray-950 text-white` (item de nav, onglet, slot sélectionné) | — |
| **Hover discret (item de liste)** | `bg-gray-100` ou `bg-gray-50` | — |
| **Hover lift (cards interactives)** | `hover:-translate-y-0.5 hover:shadow-[var(--shadow-card-elevated)] hover:border-gray-300` | — |
| **Désactivé** | `opacity-50 cursor-not-allowed` | — |
| **Chargement** | Spinner inline + `aria-busy` | `<Loader2 className="animate-spin" />` |
| **Erreur (input)** | `border-danger-600` + `focus-ring-danger` | — |

### Ombres

| Token | Usage |
|---|---|
| `shadow-overlay` | Dropdowns, popovers, tooltips |
| `shadow-modal` | Modals, dialogs |
| `shadow-card-elevated` | Cards interactives au hover |

Pas de glow coloré. Pas de halo brand. Pas de drop shadow décoratif.

### Animations

Easing unique `cubic-bezier(0.16, 1, 0.3, 1)`. Durations : `duration-fast` (150ms hover), `duration-base` (200ms défaut), `duration-slow` (350ms apparitions). Privilégier `opacity` et `scale`, jamais `slide`, jamais `bounce`.

### Radius

| Token | Valeur | Usage |
|---|---|---|
| `rounded-sm` | 4px | Inputs serrés, kbd, micro-tokens |
| `rounded-md` | 6px | Boutons, inputs, badges |
| `rounded-lg` | 8px | Cards |
| `rounded-xl` | 10px | Cards élevées |
| `rounded-2xl` (Tailwind) | 16px | Modals, hero |
| `rounded-full` (Tailwind) | — | Pills, dots, avatars |

## Couleurs auxiliaires (rôles, phases)

Gérées hors design system (`web/src/lib/slots/phase.ts`, `web/src/types/calendar.ts`). Ne pas les toucher pendant la migration UI sauf clash explicite (cas `production` repeint en `stone`).

| Famille | Source | Palette |
|---|---|---|
| Phases publication | `PHASE_COLORS` | gray (planned), yellow (shooting), stone (production), amber (admin_review), indigo (cm_review), teal (publishing), green (published), gray (terminated) |
| Rôles badges | `OWNER_BADGE_CLS` | amber (V), orange (M), indigo (C), violet (Admin) |
| Avatars rôles SlotCard | `ROLE_AVATAR_CLS` | amber (V), orange (M), indigo (C) |

## Primitives

Toutes dans `web/src/components/ui/`. Showcase exhaustif sur `/playground/primitives`.

### Boutons & actions

| Composant | API | Sizes |
|---|---|---|
| `Button` | 4 variants `primary` (gray-950 métal poli) / `secondary` / `ghost` / `danger` ; `icon?`, `iconRight?`, `loading`, `disabled` | sm (h-7) / md (h-8) / lg (h-9) |
| `ButtonIcon` | Icon-only carré, `label` obligatoire (sr-only + title) ; mêmes variants | sm (h-7 w-7) / md (h-8 w-8) |
| `DeleteButton` | ButtonIcon danger + ConfirmDialog danger sous-jacent | sm / md |
| `RefreshButton` | Bouton refresh manuel (`router.refresh()`) avec spinner 800ms ; variants `compact` (ButtonIcon) / `expanded` (Button label) | — |

### Forms

| Composant | API |
|---|---|
| `Input` | `value`/`onChange(string)`, `icon?` leading, `trailing?` (kbd, badge), `error?` |
| `Textarea` | même API que Input + resize-y |
| `FormField` | wrapper `label` eyebrow uppercase tiny + `required?` (dot danger) + `help?` + `error?` (role=alert) |
| `Switch` | `checked`/`onChange(bool)`, `label?`, `description?`, sm/md, mono dark on/off |
| `Slider` | range mono, `value`/`onChange(num)`, `min`/`max`/`step`/`unit?`/`showValue` |

### Conteneurs & atomes visuels

| Composant | Description |
|---|---|
| `Card` | conteneur sobre, props `interactive` (hover lift) / `padded` / `border` ; `CardHeader` composé pour eyebrow + actions |
| `Badge` | pill sémantique 4 variants (default/success/danger/info), sizes sm/md, support `icon?` ou `dot` |
| `Kbd` + `KbdChord` | raccourcis clavier mono compacts |
| `Skeleton` + `SkeletonRow` | loading placeholders, shapes line/block/circle |
| `CollapsibleSection` | accordéon avec persist localStorage et écoute event `pub:open-section` |
| `EmptyState` | icône wrapper + titre + description + CTA optionnel |

### Overlays & navigation

| Composant | Description |
|---|---|
| `Tabs` | 2 variants `line` (underline) / `pill` (segmented), sizes sm/md, items avec icon + badge |
| `Tooltip` | hover/focus 200ms délai, side top/bottom auto-flip, mono dark |
| `DropdownMenu` | menu d'actions click, click-outside + ESC, items + separator + destructive |
| `ConfirmDialog` | modal centrée, focus trap, ESC, variant danger |
| `Toast` + `ToastContainer` | feedback transient, 3 types sémantiques (success/error/info), auto-dismiss 4s |

### Spécialisés

| Composant | Description |
|---|---|
| `MediaDropzone` | upload drag&drop avec multipart, retries, concurrence ; styles alignés mono dark |
| `useConfirm` | hook utilitaire pour confirmation impérative |
| `HandDrawn` (signature) | Sparkle / Arrow / Underline / WavyRule / Check — usage chirurgical (cf. signature discrète) |

**Convention universelle** : toute action significative porte une icône Lucide. C'est ce qui distingue l'app dense d'une app à label.

## Signature discrète dans le SaaS (autorisée chirurgicalement)

Caveat (`font-hand`) et **un** décor handdraw (`HandDrawn.Check`) sont autorisés dans l'UI courante UNIQUEMENT sur les micro-spots ci-dessous. Tout autre usage = violation.

| Spot autorisé | Composant / Style |
|---|---|
| Logo Toolbox (nom) | `<span className="font-hand text-xl">Toolbox</span>` |
| Titre d'empty state | `<p className="font-hand text-2xl">Tout est à jour</p>` |
| Pill signature (astuce, beta, nouveau) | `<span className="font-hand text-[13px]">astuce</span>` dans pill borderless |
| Tip callout (label) | `<p className="font-hand text-[15px]">astuce</p>` |
| Lien narratif court ("voir tout") | `<a className="font-hand text-[15px]">voir tout</a>` |
| Status "fait" sur step signature | `<HandDrawn.Check />` (PAS dans tableaux denses → Check Lucide) |

**Critères d'usage** : Caveat reste **petit** (text-[13px] à text-2xl max), **discret**, **dans des contextes signature** (états résolus, milestones, annotations). Jamais en label de form, jamais en bouton, jamais en titre de page.

**Décors handdraw interdits en SaaS** : `Sparkle`, `Arrow` *en gros*, `Underline`, `WavyRule`. Restent réservés au marketing.
**`HandDrawn.Arrow` autorisé seulement** dans les liens narratifs courts type "voir tout →", à la fin d'une section.

## Tokens MARKETING ONLY

Disponibles mais **jamais en UI d'équipe**. Réservés aux landing pages futures et aux pages éditoriales hors `/publications/*`, `/calendar`, `/admin/*`, `/home`, builder.

| Élément | Token / classe | Quand |
|---|---|---|
| Serif éditoriale | `font-serif` (Instrument Serif) | Hero landing, pull quotes |
| Hand signature | `font-hand` (Caveat) | Signature, badges éditoriaux |
| Décors hand-drawn | `<HandDrawn.Sparkle/Arrow/Underline/WavyRule />` | Accents éditoriaux |
| Wash hero | `var(--gradient-hero)` | Background de hero landing |
| Wash subtle | `var(--gradient-subtle)` | Section secondaire landing |
| Grain texture | `var(--texture-grain)` | Overlay matière hero landing |

**Discipline** : si tu écris `font-serif`, `font-hand`, `bg-[var(--gradient-hero)]`, ou un composant `HandDrawn.*` dans un fichier de `app/(app)/*`, `app/(admin)/*`, ou `components/(builder|calendar|publications|admin)/*` → c'est une violation de doctrine, rollback.

## État du chantier

### v1 ui-boost — clôturé

- [x] Tokens UI mono dark + brand chirurgical
- [x] 22 primitives migrées (Button, Input, Textarea, Select, Switch, Slider, Tabs, Toast, ConfirmDialog, DeleteButton, EmptyState, Badge, Card, Tooltip, DropdownMenu, Skeleton, Kbd, MediaDropzone, RefreshButton, CollapsibleSection, FormField, ButtonIcon)
- [x] Playground v1 (tokens / primitives / marketing)
- [x] AppNav mono dark + brand chirurgical
- [x] Publications sections + ProductionChain refonte

### v2 Liquid Glass — en cours

- [x] Phase 0 : cleanup playground v1 + sentinelle
- [x] Phase 1 : tokens Liquid Glass + palette Coastal Studio + doc DS
- [ ] Phase 2 : variants `glass`/`tinted` sur les 22 primitives existantes (opt-in)
- [ ] Phase 3 : atomes nouveaux (Modal, Drawer, Sheet, Avatar, Alert, Progress, Combobox, Chip, Breadcrumb, Stepper, CommandPalette, Table, Pagination, DatePicker, TimePicker, NumberStepper)
- [ ] Phase 4 : molécules métier (VideoPlayer, AssetCard, Section, StatusBadge, OverrideControl, TrimPlayer, AssigneePicker, FilterBar, JobQueueItem, EmptyHero, SoftPanel)
- [ ] Phase 5 : playground neuf (foundations / atoms / molecules / patterns / vibes)
- [ ] Phase 6 : refonte module par module (Coquille → Fiche → Drawer → Calendar → Home → Admin libraries → Builder → Tools → Listings → Auxiliaires)
- [ ] Phase 7 : cleanup couleurs hard-codées + ESLint rule + doctrine consolidée

## Scope guard

Hook `web/scripts/scope-guard.sh` opt-in via `touch .ui-boost-active`. Interdit `lib/`, `api/`, `prisma/` pendant le chantier. Voir le hook pour le détail.
