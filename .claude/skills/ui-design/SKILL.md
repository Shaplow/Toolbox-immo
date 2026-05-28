---
name: ui-design
description: Design and fix UI in the Toolbox Immo web app. Use when a task involves layout patterns, modals, forms, panels, visual hierarchy, design tokens, interaction consistency, builder ergonomics, empty/loading/error states, or reducing interaction friction.
---

# UI UX Remediation

Use this skill for frontend cleanup tasks where the current UI works poorly, feels inconsistent, or creates unnecessary friction.

## Main Goal

Make the product easier to use through focused structural improvements, not cosmetic churn.

---

## App Shell Layout

The main shell is defined in `web/src/app/(app)/layout.tsx`:

```tsx
<div className="flex h-screen overflow-hidden bg-gray-50">
  <AppNav ... />               // collapsible sidebar
  <main className="flex-1 overflow-y-auto">
    {children}
  </main>
</div>
```

- `AppNav` (`web/src/components/layout/AppNav.tsx`) — collapsible sidebar, permission-aware nav items, impersonation banner.
- `ToolPageHeader` (`web/src/components/layout/ToolPageHeader.tsx`) — standard page header: colored icon + title + optional subtitle + `actions` slot. Use this for every tool page instead of building one-off headers.

Tool page structure expected:
```tsx
<div className="p-6 max-w-5xl mx-auto">  // or p-8 for spacious pages
  <ToolPageHeader icon={…} iconColor="indigo" title="…" subtitle="…" actions={…} />
  {/* page body */}
</div>
```

---

## Design Tokens (de facto)

These are the Tailwind classes used consistently across the app. Align new work to these; do not introduce new radius tiers, color families, or shadow levels without a clear reason.

### Colors
| Role | Class |
|------|-------|
| Primary action | `bg-indigo-600 hover:bg-indigo-700 text-white` |
| Secondary action | `border border-gray-200 text-gray-600 hover:bg-gray-50` |
| Danger action | `text-red-600 hover:text-red-700` or `bg-red-600 hover:bg-red-700 text-white` |
| App background | `bg-gray-50` |
| Card / surface | `bg-white` |
| Border | `border-gray-100` (light) or `border-gray-200` (default) |
| Muted text | `text-gray-500` |
| Label text | `text-gray-700` |
| Body text | `text-gray-900` |

### Border radius
| Context | Class |
|---------|-------|
| Modal shell, large card | `rounded-2xl` |
| Section card, container | `rounded-xl` |
| Button, input, badge | `rounded-lg` |

### Shadow
| Context | Class |
|---------|-------|
| Modal | `shadow-xl` or `shadow-2xl` |
| Card | `shadow-sm` |

### Spacing
- Tool page padding: `p-6` or `p-8`
- Section card padding: `p-5 md:p-6`
- Modal inner padding: `px-6 py-4` (header/footer), `p-6` (body)

---

## Modal Pattern

The canonical modal structure. **All modals must follow this.** Do not invent a new variant.

```tsx
// Backdrop — closes on click
<div
  className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
  onClick={onClose}
>
  // Dialog panel — stops propagation
  <div
    className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col"
    onClick={(e) => e.stopPropagation()}
  >
    {/* Header */}
    <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-500">
        <X size={16} />
      </button>
    </div>

    {/* Body */}
    <div className="p-6 overflow-y-auto">
      {/* content */}
    </div>

    {/* Footer (optional) */}
    <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-100 shrink-0">
      <button onClick={onClose} className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
        Annuler
      </button>
      <button className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium">
        Confirmer
      </button>
    </div>
  </div>
</div>
```

**Escape key**: add this effect when implementing a new modal:
```tsx
useEffect(() => {
  if (!open) return;
  const previousOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
  window.addEventListener("keydown", handleKey);
  return () => {
    document.body.style.overflow = previousOverflow;
    window.removeEventListener("keydown", handleKey);
  };
}, [open, onClose]);
```

**Common deviations to fix when encountered:**
- `bg-black/30` instead of `bg-black/60` → too transparent, fix it
- missing `backdrop-blur-sm` → add it
- missing `p-4` on the outer div → content clips on small screens
- missing `stopPropagation` on the panel → click-through closes modal unintentionally

---

## Z-Index Scale

| Layer | Value | Notes |
|-------|-------|-------|
| Default content | — | no z-index |
| Sticky header / sidebar | `z-10` | |
| Dropdown, popover | `z-20` | |
| Standard modal | `z-50` | all regular modals |
| Builder-internal modal | `z-[2000]` | `SchemaOrganizerModal` — above builder canvas overlays |
| Toast | `z-[9999]` | `Toast.tsx` — always on top |

Do not use arbitrary values outside this table without documenting the reason.

---

## Button Classes

Use these consistently. Do not create one-off button styles.

```tsx
// Primary
"px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium disabled:opacity-60 transition-colors"

// Secondary (outlined)
"px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors"

// Danger
"px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors"

// Icon button (close, action)
"w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-500 transition-colors"
```

---

## Form Control Class

Standard input/select/textarea:
```tsx
"w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400"
```

---

## Section Card Pattern

Standard container for grouped content within a page:
```tsx
<div className="bg-white rounded-2xl border border-gray-100 p-5 md:p-6 shadow-sm">
  {/* section content */}
</div>
```

---

## Shared Primitives

Use these for **all new code**. Do not duplicate the patterns below with one-off Tailwind classes.

| Component | Path | When to use |
|-----------|------|-------------|
| `AppNav` | `web/src/components/layout/AppNav.tsx` | App shell — do not duplicate |
| `ToolPageHeader` | `web/src/components/layout/ToolPageHeader.tsx` | Every tool page header |
| `Button` | `web/src/components/ui/Button.tsx` | All buttons — variants `primary \| secondary \| ghost \| danger`, sizes `sm \| md`, props `loading \| disabled \| icon` |
| `Input` | `web/src/components/ui/Input.tsx` | Controlled text input; `error` prop adds red ring |
| `Textarea` | `web/src/components/ui/Textarea.tsx` | Same API as Input + `resize-y` |
| `FormField` | `web/src/components/ui/FormField.tsx` | Label + required + help + error wrapper around any input |
| `EmptyState` | `web/src/components/ui/EmptyState.tsx` | Empty list / missing data — icon + title + description + optional CTA |
| `ConfirmDialog` | `web/src/components/ui/ConfirmDialog.tsx` | Confirmation modal with focus trap, ESC, variant `danger` |
| `DeleteButton` | `web/src/components/ui/DeleteButton.tsx` | Trash icon → ConfirmDialog; props `itemLabel`, `description?`, `onConfirm` |
| `Toast` / `useToast` | `web/src/components/ui/Toast.tsx` | `toast.success/error/info`. Never `alert()` or `confirm()` native. |

When adding a new reusable pattern, create it in `web/src/components/ui/` if it will be used in 3+ places.

---

## Recommended Workflow

1. Identify the exact user flow that feels broken: builder editing, generation, admin, form filling, preview, or a specific tool surface.
2. Map the current friction:
   - unclear labels or intent
   - weak hierarchy
   - inconsistent spacing or panel behavior
   - too many competing controls
   - missing empty, loading, or error states
   - modal patterns deviating from the canonical form above
3. Favor small, high-leverage changes:
   - align deviating modals to the canonical pattern
   - use `ToolPageHeader` where a custom header exists
   - apply correct z-index from the scale above
   - match button classes to the standard set
   - improve grouping and spacing using section card pattern
4. Do not preserve broken ergonomics just because they already exist. But do not rewire correct, stable flows.
5. Validate the affected flow manually and run `cd web && npm run lint -- path/to/changed-file.tsx`.

---

## High-Risk Areas

- The builder has dense controls and multiple side panels. Avoid adding new clutter unless you also remove or restructure something.
- Preview and generation flows are sensitive to save timing and user expectations. State transitions should be explicit, not implicit.
- Design cleanup must not break template measurement, overflow behavior, or responsive layout.
- `SchemaOrganizerModal` uses `z-[2000]` intentionally — do not lower it.

---

## Useful Areas To Inspect

- `web/src/components/builder/` — dense builder surface
- `web/src/components/ui/Toast.tsx` — only shared UI primitive beyond layout
- `web/src/components/layout/` — `AppNav`, `ToolPageHeader`
- `web/src/app/(app)/layout.tsx` — shell layout
- `web/src/app/globals.css` — minimal global CSS, design tokens are Tailwind-only

---

## Output Expectations

When using this skill, explain the specific UX problem being addressed, the intended user-facing improvement, and what was deliberately left unchanged.