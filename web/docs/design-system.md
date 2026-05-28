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

À remplir en **Phase 1**. Plan :

### Palette

| Token | Hex | Usage |
|---|---|---|
| `bg.default` | `#FFFFFF` | Fond principal |
| `bg.subtle` | `#F8F9FA` (à valider) | Fond secondaire (cards, hover discret) |
| `bg.muted` | `#F1F3F5` | Skeletons, badges neutres |
| `text.primary` | `#0A0A0A` | Texte principal |
| `text.secondary` | `#6B7280` | Texte secondaire |
| `text.muted` | `#9CA3AF` | Aide, placeholder |
| `border.default` | `#E5E7EB` | Bordures par défaut |
| `border.strong` | `#D1D5DB` | Bordures hover / actives |
| `accent.success` | TBD | Validations, statuts OK |
| `accent.danger` | TBD | Suppression, erreurs |
| `accent.info` | TBD | Annotations neutres |

### Typographie

- **Sans** : Geist Sans (via `geist/font/sans`). Tracking par défaut, sauf titres > 2xl en `tracking-tight`.
- **Mono** : Geist Mono (via `geist/font/mono`). Utilisée pour code, raccourcis clavier, IDs.

Échelle (à confirmer) :

| Token | Taille | Line-height | Usage |
|---|---|---|---|
| `text-xs` | 11px | 16px | Métadonnées, labels |
| `text-sm` | 13px | 20px | Corps principal |
| `text-base` | 14px | 22px | Texte long |
| `text-lg` | 16px | 24px | Sous-titres |
| `text-xl` | 20px | 28px | Titres section |
| `text-2xl` | 24px | 32px | Titres page |
| `text-3xl` | 30px | 38px | Hero |

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
