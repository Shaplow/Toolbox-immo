---
name: ui-design
description: Design and fix UI in the Toolbox Immo web app. Use when a task involves layout patterns, modals, forms, panels, visual hierarchy, design tokens, interaction consistency, builder ergonomics, empty/loading/error states, or reducing interaction friction.
---

# UI UX Remediation

Make the product easier to use through focused structural improvements using
the existing Liquid Glass design system. **Never reinvent surfaces, badges, or
state visuals from scratch — they already exist as primitives or molecules.**

---

## ⚠️ MANDATORY FIRST STEP — Playground Audit

Before touching any UI file, you MUST audit the playground to discover existing
patterns. **The playground is the source of truth for the design system.**

```
web/src/app/(dev)/playground/
├── foundations/page.tsx   ← tokens : colors, shadows, gradients, radius, typo
├── atoms/page.tsx         ← all primitive variants
├── atoms-new/page.tsx     ← latest Liquid Glass primitive showcase
├── molecules/page.tsx     ← Section, SoftPanel, StatusBadge, FilterBar, etc.
└── patterns/page.tsx      ← 5 production-realistic layouts (fiche / drawer /
                            listing / tool page / admin table)
```

**Workflow for any UI work** :
1. Read `playground/patterns/page.tsx` — find the closest matching layout.
2. List the primitives + molecules it uses.
3. Use those exact components in your migration. Do not create parallel
   "SectionShell", "GlassPanel", "FichePill" — they already exist.
4. If the playground has no matching pattern, ask before creating a new one.

**The recurring bug** : building parallel primitives (e.g. `SectionShell`) when
the equivalent molecule (`Section`) already exists. Always grep for similar
names before creating.

---

## ⚠️ Doctrine d'intensité (3 niveaux)

Le playground pousse la DA glass au max parce que c'est un showcase. Les
pages d'app **ne doivent jamais être en dessous** des niveaux suivants —
sinon on perd la signature et on se retrouve avec un look "Bootstrap 2015".

**Toutes les pages partagent le langage** (palette Coastal Studio, glass,
ring inset, primitives) mais l'**intensité** varie selon la fonction.

### Les 3 niveaux (référence visuelle dans le playground)

| Niveau | Référence playground | Pages cibles |
|---|---|---|
| **MAX (Showcase)** | `vibes#hero-landing` — gradient 4-stops aggressif, h1 `64px` + handwrite signature, halos peach/sky `blur-3xl opacity-30-50` aux corners, floating cards, live status pill animée | Landing public, login splash, 404/500 |
| **MID (Working)** | `vibes#control-center` (Dashboard) — **CE NIVEAU EST LE STANDARD APP**. Wrapper `rounded-3xl` + gradient pastel franc, eyebrow uppercase tracking-widest, h2 `28-36px`, live status pill glass avec dot pulse, cards `from-white/75 to-white/50 backdrop-blur-[16px]` + ring inset spéculaire, KPI cards avec icon dans wrapper tinted | Toutes les pages métier : fiche publication, home, calendrier, hubs, tools, listings, fiches client/compte |
| **SUBTLE (Admin tables)** | `patterns#admin-table` — surface `bg-gradient-to-b from-white to-white/95`, ring inset signature, density Linear `h-8`, pas de halo, h1 `20-24px` | Tables admin, builder canvas, formulaires longs (admin/users uniquement) |

### Le standard MID en détail (à savoir par cœur)

Quand tu refonds une page métier (fiche, home, calendrier, hub), tu DOIS
matcher ces caractéristiques (lit depuis `playground/vibes/page.tsx` fonction
`ControlCenter`) :

**1. Wrapper extérieur** :
```tsx
<div
  className="rounded-3xl p-6 md:p-8"
  style={{
    background: "linear-gradient(135deg, #f1f7f2 0%, #eff6fb 50%, #fdf2f4 100%)",
  }}
>
```

**2. Header de page** (top du wrapper) :
```tsx
<div className="flex items-center justify-between mb-6 flex-wrap gap-3">
  <div>
    <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500">
      {EYEBROW}  {/* ex: "FICHE PUBLICATION" */}
    </p>
    <h3 className="text-2xl font-semibold tracking-tight text-gray-950 mt-1">
      {TITLE}
    </h3>
  </div>
  {/* Live status pill glass top-right */}
  <div className="flex items-center gap-2 px-3 py-2 rounded-full bg-white/55 backdrop-blur-[12px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)]">
    <span className="inline-flex h-1.5 w-1.5 rounded-full bg-sage-500 shadow-[0_0_8px_rgba(111,162,128,0.6)] animate-pulse" />
    <span className="text-[11px] font-mono text-gray-700 tabular-nums">
      {LIVE_STATUS}  {/* ex: "21:35:58" ou "Prêt pour CM · 17h" */}
    </span>
  </div>
</div>
```

**3. Cards de contenu** (KPI / Section / sous-card) :
```tsx
className="p-5 rounded-2xl bg-gradient-to-b from-white/75 to-white/50 backdrop-blur-[16px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08),0_2px_8px_-2px_rgba(15,23,42,0.06)]"
```

**4. Icon container dans wrapper tinted Coastal Studio** :
```tsx
<div className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-{tint}-100/80 backdrop-blur-[8px] shadow-[inset_0_1px_0_rgba(255,255,255,1)] text-{tint}-700">
  <Icon size={16} />
</div>
```

**5. Big numbers / KPI values** :
```tsx
<p className="text-[28px] font-semibold tracking-tight text-gray-950 leading-none tabular-nums">{value}</p>
<p className="text-[11px] uppercase tracking-widest font-medium text-gray-500 mt-1.5">{label}</p>
```

**6. Chip / Badge typé Coastal Studio** : utiliser `<Chip variant="sky|sage|peach|rose">` et `<Badge dot>` pour les status.

**7. Stepper variant `"linear"`** (pas `"glass"`) pour ProductionChain — les step cards posées direct sur le wrapper pastel.

### Composants partagés — invariants peu importe le niveau

Identiques sur les 3 niveaux. C'est eux qui assurent la cohérence app.
**Ne JAMAIS forker** pour adapter au niveau.

- `Button`, `ButtonIcon`, `Badge`, `Chip` (variants peach/sage/sky/rose)
- `Avatar`, `AvatarGroup` (avec status dot pulse signature)
- `Section`, `SoftPanel`, `StatusBadge`, `Stepper`, `EmptyState`, `EmptyHero`
- `Modal`, `Drawer`, `Sheet`, `ConfirmDialog`, `DropdownMenu`, `CommandPalette`
- `Tabs`, `Breadcrumb`, `Pagination`, `Kbd`
- `VideoPlayer`, `AssetCard`, `JobQueueItem`

### Mapping pages → niveau (doctrine actée)

| Page / route | Niveau |
|---|---|
| `/login`, `/error` | **MAX** |
| `/home` (toute variante par rôle) | **MID** |
| `/calendar` | **MID** |
| `/publications/[id]` (fiche) | **MID** |
| `/templates` (Studio gallery) | **MID** |
| `/outils` (hub) | **MID** |
| `/admin/libraries` (hub Médiathèque) | **MID** |
| `/admin/libraries/*/*` (sous-pages média/data/font) | **MID** |
| `/admin/accounts`, `/admin/clients`, `/admin/clients/[id]` | **MID** |
| `/listings` | **MID** |
| `/captions`, `/covers`, `/descriptions`, `/transcriptions` | **MID** |
| `/admin/users` | **SUBTLE** |
| `/admin/jobs` | **SUBTLE** |
| `/builder/[id]` (canvas template) | **SUBTLE** |

**Quand tu touches une page**, regarde son niveau cible. Avant toute édition,
**ouvre `playground/vibes/page.tsx`** et trouve la référence visuelle exacte
de ton niveau. Réplique l'esprit, pas du copier-coller bête mais le même
niveau d'intensité visuelle.

---

## Design Tokens — Liquid Glass v2 (Coastal Studio)

Phase 6.1 pivoted the app from a flat indigo/gray system to a Liquid Glass v2
system with the Coastal Studio palette. **Never reintroduce indigo for primary
actions or solid `bg-white border-gray-100` for surfaces.**

### Color palette — Coastal Studio (pastels, glass-friendly)

| Role | Tint | Usage |
|------|------|-------|
| Warmth / brand signature | `peach` | Brand chirurgical (logo, primary CTA accent, "à toi" / next-action signals). |
| Calm / success | `sage` | Done states, validated actions, sage-tinted surfaces. |
| Info / next-action | `sky` | Active step, current focus, info banners, link buttons. |
| Alert / blocked | `rose` | Failed jobs, blocked states, danger actions. |
| Neutral | `gray` 50 / 200 / 700 / 950 | Text, dividers, transparent glass surfaces. |

Tailwind classes use the form `bg-peach-100/55`, `text-sage-700`, `border-sky-200/60`, etc.
The `/XX` opacity suffix is mandatory — glass surfaces are NEVER fully opaque.

The **brand orange `#FF5A1F`** is reserved for the Toolbox logo only. Do not
reuse it for actions, banners, or status badges.

### Surface system

Surfaces fall into 4 tiers — pick by role:

| Tier | Use case | Class snippet |
|------|----------|---------------|
| **Glass strong** | Modal, Drawer, CommandPalette panel | `bg-[var(--surface-glass-strong)] backdrop-blur-[20px] backdrop-saturate-150 shadow-[var(--ring-glass-inset)]` |
| **Glass solid** | Fiche sections, primary cards | `bg-gradient-to-b from-white to-white/85 backdrop-blur-[10px] backdrop-saturate-150 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.1),inset_0_-1px_0_rgba(15,23,42,0.06),0_2px_8px_-2px_rgba(15,23,42,0.08)]` |
| **Glass tinted** | Sub-cards inside sections, signals | `bg-{tint}-50/70 backdrop-blur-[8px] border border-{tint}-100/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]` |
| **Glass faint** | Collapsed section pill, empty state | `bg-[var(--surface-glass-faint)] backdrop-blur-[8px]` |

CSS variables live in `web/src/app/globals.css`. Don't redefine them inline.

### Radius

| Context | Class |
|---------|-------|
| Modal / large card / Section molecule | `rounded-2xl` |
| Mid card / panel / Stepper step | `rounded-xl` |
| Button / Input / Badge / pill | `rounded-lg` or `rounded-md` |
| Icon container (24-32px square) | `rounded-md` |
| Chip (small) | `rounded-full` |

### Shadow system — Liquid Glass signature

The signature look is **ring-inset spéculaire** (highlight on top + edge alpha
+ subtle bottom). External shadows are stacked for real floatation:

```
shadow-[
  inset_0_1px_0_rgba(255,255,255,1),         ← highlight haut blanc 1px
  inset_0_0_0_1px_rgba(15,23,42,0.08),       ← edge gris-spéculaire
  inset_0_-1px_0_rgba(15,23,42,0.04),        ← subtle bottom
  0_1px_2px_rgba(15,23,42,0.05),             ← proche
  0_8px_24px_-8px_rgba(15,23,42,0.10),       ← médiane
  0_24px_64px_-32px_rgba(15,23,42,0.14)      ← lointaine diffuse
]
```

For tinted surfaces, the edge alpha takes the tint :
`inset_0_0_0_1px_rgba(77,150,191,0.32)` for sky (RGB sky-600).

**Anti-pattern** : `shadow-sm` on solid `bg-white` — that's the OLD system.

### Spacing

- Tool page padding: `p-6` or `p-8`
- Section molecule body padding: handled by the molecule (px-5 pb-5)
- Modal inner padding: `px-6 py-4` (header/footer), `p-6` (body)

---

## Primitives Inventory (`web/src/components/ui/`)

Use these for **all new UI code**. Do not duplicate the patterns with one-off
Tailwind classes. The corresponding playground entry is in `atoms-new/page.tsx`.

### Layout & Surface

| Component | File | When to use |
|-----------|------|-------------|
| `Card` | `Card.tsx` | Generic container, variants `solid \| glass \| frosted \| tinted` |
| `CollapsibleSection` | `CollapsibleSection.tsx` | Legacy collapsible (prefer `Section` molecule for new code) |
| `Banner` | `Banner.tsx` | Sticky-top system signal (impersonation, maintenance, alerts) — variants `info \| success \| warning \| danger \| neutral` |

### Forms

| Component | File | When to use |
|-----------|------|-------------|
| `Input` | `Input.tsx` | Text input, controlled (`value`/`onChange(string)`), `error` ring + icon support |
| `Textarea` | `Textarea.tsx` | Same API + `resize-y`, variants `default \| glass` |
| `Select` | `Select.tsx` | Native select wrapper, Liquid Glass styling |
| `Combobox` | `Combobox.tsx` | Searchable select, used when 6+ options |
| `Checkbox` | `Checkbox.tsx` | Form checkbox with Liquid Glass focus halo |
| `Switch` | `Switch.tsx` | Toggle with optional label + description (vertical or aligned) |
| `Slider` | `Slider.tsx` | Range input with value display + unit |
| `NumberStepper` | `NumberStepper.tsx` | Increment/decrement number input |
| `DatePicker` | `DatePicker.tsx` | Date input glass surface |
| `TimePicker` | `TimePicker.tsx` | Time input with `minuteStep` prop |
| `FormField` | `FormField.tsx` | Label + required + help + error wrapper |

### Actions

| Component | File | When to use |
|-----------|------|-------------|
| `Button` | `Button.tsx` | All buttons — variants `primary \| secondary \| ghost \| danger`, sizes `sm \| md`, props `loading \| disabled \| icon` |
| `ButtonIcon` | `ButtonIcon.tsx` | Icon-only square button — variants `primary \| secondary \| ghost`, sizes `sm \| md` |
| `DeleteButton` | `DeleteButton.tsx` | Trash icon → ConfirmDialog (props `itemLabel`, `onConfirm`) |
| `RefreshButton` | `RefreshButton.tsx` | Refresh icon with spin animation |

### Feedback & Display

| Component | File | When to use |
|-----------|------|-------------|
| `Toast` / `toast.*` | `Toast.tsx` | `toast.success/error/info/warning(message)`. **NEVER `alert()` or `confirm()` native.** |
| `Alert` | `Alert.tsx` | Inline alert block (info/success/warning/danger) |
| `Badge` | `Badge.tsx` | Status pill — variants `default \| sage \| peach \| sky \| rose \| info \| success \| warning \| danger`, props `dot`, `icon`, `glass` |
| `Chip` | `Chip.tsx` | Tag pill — variants by tint, props `selected` (toggle), `icon`, `onClick` |
| `Tooltip` | `Tooltip.tsx` | Hover tooltip, glass surface |
| `Skeleton` | `Skeleton.tsx` | Loading skeleton with shimmer animation |
| `Progress` | `Progress.tsx` | Progress bar |
| `Avatar` | `Avatar.tsx` | User avatar with initials fallback, sizes `xs \| sm \| md \| lg` |
| `EmptyState` | `EmptyState.tsx` | Empty list — icon + title + description + optional CTA |

### Overlays

| Component | File | When to use |
|-----------|------|-------------|
| `Modal` | `Modal.tsx` | Modal dialog with `<Modal.Header>`, `<Modal.Body>`, `<Modal.Footer>` slots |
| `Drawer` | `Drawer.tsx` | Side drawer, `side="right"\|"left"\|"bottom"`, sizes `sm\|md\|lg\|xl` |
| `Sheet` | `Sheet.tsx` | Bottom sheet on mobile, drawer on desktop |
| `ConfirmDialog` | `ConfirmDialog.tsx` | Confirmation modal with focus trap, ESC, variant `danger` |
| `DropdownMenu` | `DropdownMenu.tsx` | Menu with items (label, icon, separator, destructive), `align="start"\|"end"` |
| `CommandPalette` | `CommandPalette.tsx` | Cmd+K palette with search + groups |

### Navigation

| Component | File | When to use |
|-----------|------|-------------|
| `Tabs` | `Tabs.tsx` | Tab navigation, variants `line \| pill \| segmented`, with icons |
| `Stepper` | `Stepper.tsx` | **Use for ProductionChain or any step progression.** Variants `linear \| glass \| compact`, horizontal/vertical, clickable steps |
| `Breadcrumb` | `Breadcrumb.tsx` | Path navigation with icons + chevrons |
| `Pagination` | `Pagination.tsx` | Page navigation with range display |
| `Kbd` | `Kbd.tsx` | Keyboard shortcut display (⌘, K, Enter, Esc) |

### Specialized

| Component | File | When to use |
|-----------|------|-------------|
| `MediaDropzone` | `MediaDropzone.tsx` | Upload zone with drag & drop, file kind validation, multiple |
| `Table` | `Table.tsx` | Sortable + selectable table with columns API |
| `useConfirm` | `useConfirm.tsx` | `await confirm({...})` programmatic ConfirmDialog |
| `useDialogStack` | `useDialogStack.ts` | Manage stacked dialogs / portals |

---

## Molecules Inventory (`web/src/components/ui/molecules/`)

Higher-level compositions assembling primitives into reusable patterns. The
corresponding playground entry is in `molecules/page.tsx`. **Always check this
before building anything section-shaped or list-shaped.**

| Component | File | When to use |
|-----------|------|-------------|
| `Section` | `Section.tsx` | **Standard wrapper for page sections** — icon + title + description + actions + collapsible + storageKey + sectionId (for `pub:open-section` event). Variants `default \| glass \| tinted`. **Use this instead of any custom card wrapper.** |
| `SoftPanel` | `SoftPanel.tsx` | Tool page wrapper with sticky header + scrollable body + bottom toolbar |
| `StatusBadge` | `StatusBadge.tsx` | Badge typed by domain (`render \| caption \| description \| cover \| slot \| transcription`). Resolves variant + label + icon from `lib/ui/statusMapping.ts`. **Use this for ANY job/slot status display.** |
| `AssigneePicker` | `AssigneePicker.tsx` | Dropdown with Avatar + name, filters by role |
| `OverrideControl` | `OverrideControl.tsx` | Pattern override toggle with inherited value display |
| `AssetCard` | `AssetCard.tsx` | Media card for listings — video/image preview, 9:16 aspect, selectable, badges, actions |
| `FilterBar` | `FilterBar.tsx` | Sticky filter bar with active-count badge + reset button |
| `JobQueueItem` | `JobQueueItem.tsx` | Single job row — title + description + status + progress + actions |
| `EmptyHero` | `EmptyHero.tsx` | Empty state hero (larger than EmptyState) for empty pages |
| `VideoPlayer` | `VideoPlayer.tsx` | Video player with custom controls |
| `TrimPlayer` | `TrimPlayer.tsx` | Video player with trim range selectors |

---

## Canonical Patterns (from `playground/patterns/page.tsx`)

Read this file to see 5 production-realistic layouts in action. Replicate them
directly instead of reinventing.

### Pattern 1 — Fiche détail (publication, admin entity)

```tsx
<div className="space-y-4">
  {/* Header glass : breadcrumb + title + status badges + actions */}
  <div className="rounded-2xl px-5 py-4 bg-gradient-to-b from-white to-white/85 backdrop-blur-[12px] ...">
    <Breadcrumb items={...} />
    <h3>...</h3>
    <StatusBadge domain="slot" status={...} />
    <Button icon={Send}>Action principale</Button>
  </div>

  {/* Production chain — Stepper variant glass */}
  <Stepper variant="glass" steps={steps} active={activeStep} onClickStep={...} />

  {/* 2-col layout : sections gauche + sidebar droite */}
  <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
    <div className="space-y-3 min-w-0">
      <Section title="Brief client" icon={FileText} actions={<StatusBadge domain="cover" status="READY" />} collapsible>
        ...
      </Section>
      <Section title="Captions" icon={Captions} actions={<StatusBadge domain="caption" status="GENERATING" />}>
        <JobQueueItem job={...} />
      </Section>
    </div>
    <aside className="space-y-3">
      <Section title="Assignations" icon={UserCircle2}>
        <AssigneePicker .../>
      </Section>
    </aside>
  </div>
</div>
```

### Pattern 2 — Quick edit drawer

`<Drawer>` + `<Tabs variant="line">` + `<Combobox>` / `<DatePicker>` / `<TimePicker>` / `<OverrideControl>` / `<AssigneePicker>` / `<Switch>` inside.
Footer with `<Button variant="secondary">Annuler</Button> + <Button>Enregistrer</Button>`.

### Pattern 3 — Listing grid (médias)

`<FilterBar>` (with `<Input icon={...}>` + `<Combobox>` + `<Chip>` selected toggles) + bulk action bar (glass tinted sky) + grid `<AssetCard>` 9:16 selectable + `<Pagination>`.

### Pattern 4 — Tool page (preset / settings editor)

`<SoftPanel>` with `<Breadcrumb>` in header + Toolbar (Annuler / Enregistrer) + body composed of multiple `<Section>` containing `<Input>` / `<Textarea>` / `<Select>` / `<Switch>` / `<DatePicker>` / `<JobQueueItem>`.

### Pattern 5 — Admin table

`<FilterBar>` + `<Button icon={Plus}>` + bulk action bar + `<Table>` (sortable, selectable, with custom cell renderers using `<Avatar>` + `<Chip>` + `<Badge dot>`) + `<Pagination>` + `<Modal>` for row edit.

---

## Anti-patterns — Reject on sight

| ❌ Don't | ✅ Do |
|---------|------|
| `bg-white border border-gray-100 rounded-2xl p-8 shadow-sm` (OLD section card) | `<Section title="..." icon={...}>` molecule |
| Custom `<div>` step indicator with bg-info-50/100 pop colors | `<Stepper variant="glass">` molecule |
| `bg-indigo-600 hover:bg-indigo-700` primary CTA | `<Button variant="primary">` (uses gray-950 with glass halo) |
| `<button type="button" className="inline-flex...">` inline button | `<Button>` or `<ButtonIcon>` primitive |
| `<textarea className="w-full border rounded-lg...">` native | `<Textarea>` primitive |
| Custom status pill `<span className="bg-success-100...">` | `<StatusBadge domain="..." status="..." />` molecule |
| `alert()` / `confirm()` / `prompt()` native | `toast.*()` / `<ConfirmDialog>` / `useConfirm()` |
| `<details>` / `<summary>` native collapsible | `<Section collapsible>` molecule |
| `✓` / `✕` unicode marks for status | `<CheckCircle>` / `<XCircle>` Lucide icons with proper color class |
| New "GlassPanel" / "FichePill" / "SectionShell" component | Grep first — it already exists |
| `bg-amber-*` color | Use `peach` tint (Coastal Studio replacement for amber) |
| `bg-fuchsia-*` / `bg-violet-*` color | Use `rose` or `sky` tint |
| `bg-indigo-*` color | Use `sky` tint (Coastal Studio replacement for indigo) |

---

## Z-Index Scale

| Layer | Value | Notes |
|-------|-------|-------|
| Default content | — | no z-index |
| Sticky header / sidebar | `z-10` | |
| Sticky banner (NextActionBanner) | `z-20` | above sticky header |
| Dropdown, popover, Tooltip | `z-30` | |
| Standard modal / drawer / sheet | `z-50` | portal'd to `document.body` |
| Builder-internal modal | `z-[2000]` | `SchemaOrganizerModal` — above builder canvas overlays |
| Toast | `z-[9999]` | always on top |

**Containing block trap** : `backdrop-filter` creates a new containing block.
Any `position:fixed` child (modal, drawer, palette) inside a `backdrop-blur`
parent will be trapped. Solution : `createPortal(node, document.body)`.

---

## App Shell Layout

```tsx
// web/src/app/(app)/layout.tsx
<div className="fixed inset-0 flex bg-gray-50">
  <AppNav ... />
  <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
    {banners}                          // ImpersonationBanner if applicable
    <div className="flex-1 min-h-0 overflow-y-auto">
      {children}
    </div>
  </main>
  {userContext.canAdminBypass && <AdminCommandPalette />}
</div>
```

- `AppNav` — collapsible sidebar, permission-aware nav, user footer (Phase 6.1)
- `ImpersonationBanner` — sticky top warning when impersonating (uses `Banner` primitive)
- `AdminCommandPalette` — Cmd+K palette (admin only)

**`fixed inset-0`** is intentional : the body has `min-h-screen` (extensible),
so without `fixed` the inner `h-screen` aside renders on the stretched body and
the user footer falls below the visible area.

---

## Tool Page Structure

```tsx
<div className="p-6 max-w-5xl mx-auto">  // or p-8 for spacious pages
  <ToolPageHeader icon={...} iconTint="peach" title="..." subtitle="..." actions={...} />
  {/* page body — typically a stack of <Section> molecules */}
</div>
```

- `ToolPageHeader` (`web/src/components/layout/ToolPageHeader.tsx`) — use
  `iconTint` (peach / sage / sky / rose / neutral), not legacy `iconColor`.

---

## Recommended Workflow

1. **Audit playground FIRST** : `playground/patterns/page.tsx` for layout, then
   `molecules/page.tsx` and `atoms-new/page.tsx` for individual components.
2. **Grep for existing primitives** before creating any new component :
   ```bash
   grep -rn "section\|card\|panel\|pill" src/components/ui/ | head
   ```
3. **Identify the friction** :
   - unclear labels or intent
   - weak hierarchy
   - inconsistent spacing or panel behavior
   - too many competing controls
   - missing empty / loading / error states
   - usage of OLD system (indigo / bg-white solid / shadow-sm)
4. **Apply the canonical pattern** from playground.
5. **Validate visually** with Playwright at 1440×900 (default viewport).
6. **Run** `cd web && npm run lint -- path/to/file.tsx` and `npm run test:unit`.

---

## Output Expectations

When using this skill, explain:
- Which playground pattern you matched against.
- Which primitives + molecules you reused.
- What was deliberately left unchanged (don't churn working flows).
- One screenshot of the result if a UI surface was changed.
