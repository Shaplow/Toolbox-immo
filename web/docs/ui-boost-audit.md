# UI Boost — Audit Phase 2

Audit hot/cold UX produit par 4 agents `ux-auditor` en parallèle (2026-05-29). Synthèse pour piloter la migration des surfaces (Phase 3+).

## Constat global — patterns transversaux

| Pattern | Surfaces | Action |
|---|---|---|
| `bg-indigo-600` CTA inline | Home, Calendar, Fiche, Builder | grep/replace → `<Button variant="primary">` |
| `bg-indigo-50 / border-indigo-300` sélection | Calendar, Builder, Fiche | → `bg-gray-950 text-white` (doctrine sélection mono) |
| `focus:ring-indigo-300` ad hoc | Tous | → classe `focus-ring` |
| `<select>` natifs (9+) | Builder, Calendar SlotDetail | **Bloquant** : primitive `Select` à créer |
| `<input type="range">` natif | Builder Cover, Music | → `<Slider />` |
| Dropdowns artisanales | Header fiche, Builder | → `<DropdownMenu />` |
| `window.confirm()` natif | Builder | → `<ConfirmDialog />` |
| Empty states italic gray-400 | Fiche Comments, Builder | → `<EmptyState />` (titre Caveat) |
| Couleur **fuchsia** | Calendar SlotDetailPanel + AddSlotModal | Hors palette → neutraliser en gray |

## Frictions par surface

### Home (HomeAdmin / Monteur / CM / Vidéaste / ExternalClient)

- HomeAdmin : KPI cards en 4 couleurs hors doctrine (red/amber/orange/fuchsia/blue/indigo). "Sans vidéaste" count incohérent (inclut auto_template).
- HomeMonteur : section "Mes envois en attente client" custom dupliquée. Badge "En révision admin" ne montre pas le V2.
- HomeCm : `CM_STATUS_BADGES` injecte violet/blue/green/amber inline. Empty states `bg-green-50` décoratif.
- HomeVideaste : bloc "Shoots livrés" `bg-emerald-*`. `mode="admin"` passé incorrectement à WorklistSection (bug fonctionnel + couleurs).
- HomeExternalClient : icône `Wrench` inappropriée. CTA "Générer" en `text-gray-400` ambigu.

**Composants partagés** : `WorklistSlotCard` + `WorklistSection` — utilisés par 3 rôles, migration = effet × 3.

### Calendar (`web/src/components/calendar/`)

- **CalendarView** : top bar boutons raw (chevron, Aujourd'hui, refresh) à harmoniser. Badge "X pour toi" indigo. Label CTA "+ Slot" ambigu.
- **SlotCard** : 5 lignes de hiérarchie égale (heure + titre + sous-titre + owner + handle + avatars + phase + pattern + dots) — trop dense. Border-left `indigo-500` "isMine" hors doctrine. Padding `p-3` à serrer.
- **SlotDetailPanel** : 🚨 **`fuchsia` overrides bloc + `indigo-600` CTA Sauvegarder + `indigo-300` focus ring**. Selects natifs partout (statut, assignations, overrides).
- **AddSlotModal** : tab nav custom proche de `Tabs variant="pill"`. Options production `fuchsia` à neutraliser.
- **PipelineDots** : statut "todo" `bg-gray-300` vs "muted" `bg-gray-100 opacity-30` trop proches. Pas de Tooltip primitive.

### Fiche publication `/publications/[id]`

- **PublishSection** : action quotidienne CM, formulaire natif + tous boutons custom indigo. ROI maximal.
- **PublicationHeader** : sticky toutes visites — CTA "Marquer publié" indigo, dropdown ⋯ artisanale (backdrop z-10 conflit modals), badge statut rounded-full duplique `<Badge>`, density `py-3/mt-3/gap-3` trop large.
- **NextActionBanner** : `bg-indigo-50 border-indigo-200` violent. Lien `<a href="#...">` natif n'ouvre pas la section si repliée (bug fonctionnel).
- **ProductionChain** : 6 couleurs sémantiques (indigo/green/red/yellow/purple/gray) — `purple` "blocked" hors doctrine. StepIcon SVG inline alors que Lucide dispo.
- **RenderSection** : 4 boutons d'action custom indigo + "Force fail" rouge custom.
- **CommentsSection** : empty state `italic gray-400` illisible + pagination `text-amber-600` hors doctrine.

### Builder (`web/src/components/builder/`)

- **BuilderClient** : bouton "Sauvegarder" `bg-indigo-600` (CTA permanent toute session). Rail panneau actif `bg-indigo-50 text-indigo-700`. Indicator dots `bg-indigo-400`. `window.confirm()` natif pour le guard "modifications non sauvegardées".
- **BlocksPanel** : sélection bloc indigo (border/bg/ring l.162-174,289-293,333). Boutons "↑ ↓" auto-layout custom (à passer en `ButtonIcon`).
- **VideoSequencePanel** : CTA "Créer le premier clip" indigo. Source badges `violet-100`, `blue-50` hors doctrine.
- **Cover/Captions/Music** : `<input type="range">` natifs avec `accent-indigo-600`. `<input type="checkbox">` sans cohérence. `<select>` × 8 occurrences (SettingsPanel, MusicPanel, CaptionsTabPanel) — bloquant sans primitive `Select`.
- **PropertiesPanel + SettingsPanel** : callout info indigo (`bg-indigo-50`) au lieu de `info-50`. Kbd inline qui devrait utiliser `Kbd`.
- **Canvas (1800 lignes)** : 3 spots chrome à migrer (Grid/Snap actifs, counter multi-sélection). Le rendu de blocs (~600 lignes) NE doit PAS être migré. Migration incrémentale OK.

## Ordre de migration recommandé

| Étape | Périmètre | Tempo | ROI |
|---|---|---|---|
| **0** | Créer primitive `Select` dans `ui/` | 30 min | Débloque tout |
| **1** | Phase 3 — refonte coquille (AppNav + layout `(app)` + breadcrumbs) | 2h | 100% sessions |
| **2** | Pattern transverse — find/replace indigo→gray-950, fuchsia→neutral, ad hoc focus rings | 1-2h | Effet immédiat partout |
| **3** | Fiche `/publications/[id]` (PublishSection > Header > NextActionBanner > RenderSection > Comments > ProductionChain) | 4h | Surface la plus utilisée |
| **4** | Home + WorklistSlotCard (composant partagé 3 rôles) | 2h | Surfaces quotidiennes |
| **5** | Calendar (SlotCard density + SlotDetailPanel selects + AddSlotModal) | 2h | Orchestration admin |
| **6** | Builder polish (BuilderClient + rail + sélection + selects + Canvas chrome) | 3h | Module central |
| **7** | HomeExternalClient + admin pages | 2h | Secondaire |

**Total ~16h** spread sur plusieurs sessions.

## Décisions actées

- Primitive `Select` à créer en Phase 3 step 0 (avant tout le reste).
- Migration transverse indigo→gray-950 fait en step 2 plutôt que par-surface (effet immédiat + évite la dette pendant la migration ciblée).
- Canvas migration incrémentale (3 spots), pas de chantier dédié.
- `mode="admin"` HomeVideaste = bug fonctionnel à corriger pendant Step 4, pas du polish UI.
