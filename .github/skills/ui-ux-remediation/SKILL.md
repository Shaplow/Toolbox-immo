---
name: ui-ux-remediation
description: Improve confusing, inconsistent, or cluttered UI and UX flows in the Toolbox Immo web app. Use when the task is about usability, visual hierarchy, builder ergonomics, forms, panels, states, or reducing interaction friction without rewriting the whole product.
---

# UI UX Remediation

Use this skill for frontend cleanup tasks where the current UI works poorly, feels inconsistent, or creates unnecessary friction.

## Main Goal

Make the product easier to use through focused structural improvements, not cosmetic churn.

## Recommended Workflow

1. Identify the exact user flow that feels broken: builder editing, generation, admin, form filling, preview, or a specific tool surface.
2. Map the current friction:
   - unclear labels or intent
   - weak hierarchy
   - inconsistent spacing or panel behavior
   - too many competing controls
   - missing empty, loading, or error states
   - mobile or smaller-screen breakage
3. Favor small, high-leverage changes:
   - improve grouping and spacing
   - simplify copy
   - clarify CTAs
   - reduce visual noise
   - align behavior across similar panels and controls
4. Reuse existing UI primitives where they are sufficient, but do not preserve broken ergonomics just because they already exist.
5. Validate the affected flow manually in addition to linting.

## High-Risk Areas

- The builder has dense controls and multiple side panels. Avoid adding new clutter unless you also remove or restructure something.
- Preview and generation flows are sensitive to save timing and user expectations. Changes should make state transitions clearer, not more implicit.
- Design cleanup should not break template measurement, overflow behavior, or responsive layout.

## Useful Areas To Inspect

- `web/src/components/builder/`
- `web/src/components/ui/` (minimal — currently only `Toast.tsx`; there is no shared component library beyond inline Tailwind classes)
- `web/src/app/`
- `web/src/app/globals.css`

## Output Expectations

When using this skill, explain the specific UX problem being addressed, the intended user-facing improvement, and what was deliberately left unchanged.