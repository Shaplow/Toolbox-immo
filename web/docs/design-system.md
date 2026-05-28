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

### Brand color

Une couleur signature en plus des accents sémantiques — le "peps" Apple-like de l'app, réservée aux CTA principaux, liens narratifs et highlights marketing. **Jamais** utilisée pour communiquer un statut (succès / erreur / info).

| Stop | Hex | Usage |
|---|---|---|
| `brand-50`  | `#eff6ff` | Wash très subtil (hero bg) |
| `brand-100` | `#dbeafe` | Halo doux |
| `brand-500` | `#3b82f6` | Lien hover, badge new |
| `brand-600` | `#0070f3` | **Couleur principale** : CTA primaire, liens |
| `brand-700` | `#0058c4` | Hover state du CTA |
| `brand-900` | `#0040a0` | Highlights inverses (texte brand sur bg foncé) |

### Effets

- `shadow-overlay` / `shadow-modal` — élévation sobre des overlays.
- `shadow-card-elevated` — surfaces marketing (cards photos, hero).
- `shadow-glow-brand` / `shadow-glow-brand-strong` — halo coloré au repos / hover sur les CTA brand. C'est ce qui donne le "peps".
- `--gradient-hero` — wash bleu très léger pour les sections de mise en avant.
- `--gradient-subtle` — gradient blanc → gray-50 pour les sections secondaires.

Accès via `style={{ background: "var(--gradient-hero)" }}` ou `className="bg-[var(--gradient-hero)]"`.

### Typographie

- **Sans** : Geist Sans (via `geist/font/sans`). Tracking par défaut, sauf titres ≥ `text-2xl` en `tracking-tight`.
- **Mono** : Geist Mono (via `geist/font/mono`). Pour code, raccourcis clavier, IDs, valeurs hex.

Échelle Tailwind par défaut (`text-xs` à `text-3xl`). Voir `/playground/tokens` pour la rendu visuel.

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
