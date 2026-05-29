# Toolbox Immo — Design System

> SaaS d'équipe pour agence social media. Sobre, dense, fonctionnel, avec une identité reconnaissable au détail près. Doctrine figée — toute évolution doit la respecter ou la modifier explicitement ici.
> Plan vivant : `/Users/mathis/.claude/plans/ui-boost-plan.md`. Playground : `/playground` (gated `NEXT_PUBLIC_DEV_PLAYGROUND=1`).

## Doctrine — en 5 phrases

1. **L'UI Toolbox = Geist Sans + monochrome + density Linear + icon-first.** Pas un seul élément de plus.
2. **Le primary CTA = `bg-gray-950` flat.** Vercel, Linear, Apple le font, on le fait. Aucun gradient, aucune couleur, aucun glow.
3. **Le brand orange `#FF5A1F` apparaît à 2 endroits dans toute l'app :** le logo Toolbox et un dot indicateur dans la nav. C'est sa rareté qui le rend mémorable.
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

`brand-50` à `brand-900` disponibles. **Mais utilisé à 2 endroits seulement dans toute l'app** : logo Toolbox et 1 dot indicateur dans la nav. Toute autre apparition est un bug de discipline.

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

| Composant | Variants | Sizes |
|---|---|---|
| `Button` | `primary` (gray-950) / `secondary` / `ghost` / `danger` | sm / md / lg |
| `ButtonIcon` | idem (4 variants) | sm / md |
| `Input` | icône leading optionnelle, trailing optionnel | — (h-8) |
| `Textarea` | resize-y | — |
| `FormField` | wrapper label eyebrow + required + help + error | — |
| `EmptyState` | icône + titre + description + CTA | — |
| `ConfirmDialog` | focus trap, ESC, variant danger | — |
| `DeleteButton` | Trash + ConfirmDialog | — |
| `Toast` | success / error / info | — |

Convention : **toute action significative porte une icône Lucide**. C'est ce qui distingue l'app dense d'une app à label.

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

- [x] Phase 0 : setup
- [x] Phase 1 : tokens + primitives (lot 1 Button + lot 2 forms commités)
- [x] Doctrine harmonisée (suite à retour critique)
- [ ] Phase 1 suite : ConfirmDialog, DeleteButton, EmptyState, Toast, Badge, Card, Tabs, Tooltip, DropdownMenu, Skeleton, Switch, Kbd
- [ ] GATE 1 final
- [ ] Phase 2-6 (audit, surfaces, polish)

## Scope guard

Hook `web/scripts/scope-guard.sh` opt-in via `touch .ui-boost-active`. Interdit `lib/`, `api/`, `prisma/` pendant le chantier. Voir le hook pour le détail.
