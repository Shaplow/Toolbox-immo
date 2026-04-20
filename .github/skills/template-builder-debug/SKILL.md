---
name: template-builder-debug
description: Diagnose template builder issues involving auto-layout groups, text measurement, builder versus HTML preview mismatches, timed visibility, background effects, and preview parity. Use when a bug touches Canvas.tsx, buildHTML.ts, layout snapshots, or template rendering logic in the web app.
---

# Template Builder Debug

Use this skill when a task involves the template builder, preview parity, grouped text positions, timed visibility, or per-line text background effects.

## Main Goal

Identify the exact layer that is wrong before editing code.

- Visible builder preview in React
- Hidden builder measurement layer
- HTML preview generated from `buildHTML`
- Final render pipeline if the issue survives both preview layers

## Recommended Workflow

1. Start in the web app, not the render engine.
2. Inspect the builder entry points:
   - `web/src/components/builder/Canvas.tsx`
   - `web/src/components/builder/BuilderClient.tsx`
   - `web/src/components/builder/PropertiesPanel.tsx`
3. Inspect layout and normalization helpers:
   - `web/src/lib/groupLayout.ts`
   - `web/src/lib/templateNormalization.ts`
   - `web/src/lib/templateConditions.ts`
   - `web/src/lib/layoutDebug.ts`
4. Compare with the HTML render layer:
   - `web/src/lib/renderer/buildHTML.ts`
   - `web/src/lib/renderer/blocks/renderTextBlock.ts`
5. Only inspect the render engine if the HTML preview is already wrong or if the bug exists only in final media output.

## Common Failure Modes

- Timing-hidden blocks are kept in the DOM with `visibility: hidden` and `data-timing-hidden="true"` so group auto-layout does not collapse. If a group reflows when a timed block should disappear, check that `hiddenBlockIds` is passed correctly to `buildHTML` and that the CSS rule `[data-timing-hidden="true"] { visibility: hidden !important }` is present.
- Builder preview scales text differently from HTML preview.
- Font loading or font-metric invalidation causes stale text measurements after opening or editing a template.
- Group gap, order, or anchor data is correct in JSON but the builder does not recompute positions on first load.
- Per-line backgrounds or gooey filters are visually out of sync between builder and HTML because the scaling model changed.

## Validation Checklist

- Compare builder preview and HTML preview before touching render-engine code.
- If the issue involves text sizing or wrapping, force yourself to inspect font loading and measurement invalidation.
- If the issue involves group position, inspect both saved layout data and the runtime recomputation path.
- Run targeted lint on touched web files.

## Output Expectations

When using this skill, explicitly say which layer is wrong and why. Avoid vague conclusions like "render mismatch" without naming the exact pipeline stage.