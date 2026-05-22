---
name: ass-rendering
description: Diagnose and fix ASS subtitle file generation for captions rendering. Use when a task touches ass_writer.py, layout.py, line spacing, shadow rendering, glow effects, animation presets (appear/reveal/word_pop), highlight style inheritance, libass quirks, or visual output that does not match the expected captions style.
---

# ASS Rendering

Use this skill when the task involves the ASS subtitle generation layer: visual bugs (spacing, shadows, effects), animation preset behavior, highlight styling, or libass-specific quirks. This layer is entirely inside `render-engine/engine/`.

It is **not** the same as the captions orchestration layer (jobs, RunPod, R2). For those, use the `captions-transcription` skill.

## Key Files

| File | Role |
|---|---|
| `render-engine/engine/ass_writer.py` | Generates the `.ass` file from layout blocks + config |
| `render-engine/engine/layout.py` | Font metrics, block splitting, line positioning |
| `render-engine/engine/models.py` | `StyleConfig`, `RenderConfig`, `LayoutConfig`, `AnimationConfig` |
| `render-engine/engine/render.py` | Entry point — calls layout then `write_ass_file()`, then FFmpeg subtitle filter |
| `render-engine/engine/fonts.py` | Font path resolution for PIL measurement |

> `_resolve_captions_engine()` in `app.py` always returns `"ass"`. No other captions engine is active or present in the repo.

## Config Model Quick Reference

**`LayoutConfig`** (inside `RenderConfig.layout`):
- `anchor`: `"bottom"` / `"center"` / `"top"` — where the block attaches
- `max_lines`: 1–5 lines per block
- `line_gap_ratio`: extra gap between lines as a ratio of ink height (default 0.22)
- `line_height_mode`: `"fixed_box"` (default) or `"painted_gap"` — affects total block height
- `vertical_offset`: fractional offset from anchor (–0.5 → +0.5 of video height)
- `safe_area`: per-side safe zone (ratios)

**`StyleConfig`** (used for `base_style`, `highlight_style`, `highlight_style2`):
- `size_ratio`: font size as fraction of video height
- `shadow`: directional shadow distance (pixels at `PlayResY`)
- `shadow_angle`: angle in degrees (90° = straight down)
- `shadow_blur`: radius for soft ambient halo via `\bord`+`\blur`
- `shadow_alpha`: opacity 0–1 (converted to inverted ASS alpha)
- `shadow_color`: hex color
- `glow_intensity`: border size for coloured glow halo
- `glow_color`: hex color
- `outline`: hard outline width (no blur)
- `outline_color`: hex color
- `spacing`: letter spacing (passed directly to ASS `Spacing` field)
- `blur`: legacy `\be` blur (distinct from `shadow_blur`)

**`AnimationConfig.preset`**: `"none"` / `"appear"` / `"reveal"` / `"word_pop"`

## ASS Format Gotchas

### Color encoding
ASS colors are **BGR** (reversed from CSS/RGB), with `&H00` prefix for primary:
```
#FF8800 → &H0088FF  (R=FF, G=88, B=00 → B=00, G=88, R=FF)
```
The helpers `_hex_to_ass_color()`, `_hex_to_ass_tag_color()`, and `_hex_to_bgr6()` handle this. Never write hex colors by hand in inline tags.

### Alpha encoding
ASS alpha is **inverted**: `&H00&` = fully opaque, `&HFF&` = fully transparent.  
`_alpha_to_ass(opacity)` converts correctly: `0.0 → FF`, `1.0 → 00`.

### `\an` is a line-level tag
`\an` (alignment/anchor) **must not appear inside `\r` inline resets**. libass interprets it as a new positioning anchor and jumps the line. All positioning is set once in the outer tag block; `\r` resets only switch named styles.

### `\t(\4a)` is unreliable in libass
Animating shadow alpha (`\4a`) through `\t()` can glitch or not fire reliably in libass.  
**Solution (used in `appear` preset)**: emit separate Dialogue events per word step so that `\4a` is always a static value, never animated. Shadow appears immediately on the current word; only fill (`\1a`) and outline (`\3a`) are faded.

### `\bord` / `\3c` / `\blur` are a shared slot
Only one border effect can use these three tags at a time. The priority is:
```
glow_intensity > shadow_blur > outline > nothing
```
When **both** `glow_intensity > 0` **and** `shadow_blur > 0` are active on the same style, two separate Dialogue events are emitted (the two-layer system — see below).

### `ScaledBorderAndShadow: yes`
This must be in `[Script Info]`. It scales border and shadow values with the video resolution so that `\bord4` looks the same on 720p and 1080p.

## Effect System

### Border priority (single layer)
`_style_effect_tags(style)` outputs the correct tags in priority order:
1. `glow_intensity > 0` → `\bord{glow_intensity}\3c{glow_color}\3a&H00&\blur{...}`
2. `shadow_blur > 0` → `\bord{shadow_blur}\3c{shadow_color}\3a{alpha}\blur{shadow_blur}`
3. `outline > 0` → `\bord{outline}\3c{outline_color}\3a&H00&\blur0`
4. else → `\bord0`

### Directional shadow
Uses `\xshad`/`\yshad` computed from `shadow` (distance) and `shadow_angle`:
```python
radians = math.radians(style.shadow_angle)
xshad = style.shadow * math.cos(radians)
yshad = style.shadow * math.sin(radians)
```

### Glow + directional shadow combined
When `glow_intensity > 0` **and** `shadow > 0`, the glow takes `\bord`, so the directional shadow uses the `\4c` layer (`\xshad\yshad\4c{color}\4a{alpha}`).

### Two-layer rendering
`_needs_two_layers(style)` returns `True` when `shadow_blur > 0` AND (`glow_intensity > 0` OR `outline > 0`).  
In this case `write_ass_file` emits **two Dialogue events** per line:
- **Layer 0**: shadow-blur halo (glow suppressed)
- **Layer 1**: glow or outline (shadow_blur suppressed)

libass composites layer 0 below layer 1, so the halo sits behind the glow as intended.

Checked via `_style_for_layer(style, layer)` which returns a copy with the unused effect set to 0.

### Highlight shadow inheritance
`_hl_style_with_shadow(hl_style, base_style)` — if the highlight style has no shadow of its own (`shadow=0` and `shadow_blur=0`), it **inherits the base style shadow settings**. This prevents highlighted words from floating without a shadow when the base has one.

## Animation Presets

### `none`
One static Dialogue event per line per block. All words always visible.

### `appear`
Word-by-word appearance with a 60 ms fill+outline fade.
- One Dialogue event per **line** per **word step** (not one event per line per block).
- Future words on the same line: `\1a&HFF&\3a&HFF&\4a&HFF&` (all channels hidden, static).
- Current word: `\1a&HFF&\3a&HFF&\t(0,60,\1a&H00&\3a{a3})` — shadow `\4a` NOT animated (avoids libass bug).
- Past words: fully visible.
- All lines of the block are emitted on every step as placeholders so block height is stable.

### `reveal`
Letter-by-letter typewriter. One Dialogue event per line for the whole block duration.  
Each letter has: `\1a&HFF&\3a&HFF&\4a&HFF&\t({delay},{delay+1},\1a&H00&\3a{a3}\4a&H00&)`.  
The 1 ms reveal window makes the shadow artefact imperceptible.

### `word_pop`
One word visible at a time, no overlap, instant cut.  
Each word gets its own Dialogue event spanning from its start to the next word's start.

## Line Spacing and Layout

### `line_gap_ratio`
Additional vertical gap between lines, expressed as a ratio of **ink height**:
```python
gap = int(round(line_gap_ratio * _line_height_ink(font)))
```
A value of `0.0` means lines are packed tightly. `0.22` (default) adds ~22% of a line height as gap.

### `_line_height_ink` vs `_line_height_design`
- `_line_height_ink(font)` — visual glyph height (`getbbox("Hg")`). Used for **line pitch** (gap calculation).
- `_line_height_design(font)` — full ascent + descent. Used for **total block height** calculation so that `\an8`-anchored blocks don't push the last line outside the safe area on 3+ line blocks.

> **Gotcha**: using ink height for block total height underestimates it and causes the bottom of tall blocks to clip outside the safe area.

### `vertical_offset`
Applied after anchor positioning as a fraction of video height. Positive = down, negative = up. Useful for nudging captions slightly without touching the safe area.

### `line_height_mode`
- `"fixed_box"` (default): total block height uses design height per line. Stable for multi-line.
- `"painted_gap"`: uses ink height, producing tighter stacking. Can clip on tall fonts.

## Common Bug Patterns

| Symptom | Likely cause | Where to look |
|---|---|---|
| Shadow missing on highlighted words | `_hl_style_with_shadow()` not inheriting from base | `ass_writer.py` — shadow check |
| Lines jump vertically on reveal/appear | `\an` inside `\r` reset or future word placeholder using wrong size | `_base_words_text`, `_base_words_text_appear` |
| Last line clips outside safe area on 3+ line block | Block height calculated with ink height instead of design height | `layout.py` — `_line_height_design` |
| Shadow appears but immediately disappears on appear preset | `\t(\4a)` libass reliability issue — `\4a` is being animated | Must use static `\4a` masking in separate Dialogue events |
| Glow and soft shadow both present but only one shows | Both effects competing for `\bord` slot — two-layer mode not triggered | `_needs_two_layers()` condition in `ass_writer.py` |
| Reveal letters appearing at wrong time | `block_start` reference point wrong in `_animated_line_text` | `word.start - block_start` must use block's first word start |
| Letter spacing not applied | `spacing` field not set in `StyleConfig` | Passed as `Spacing` in `_style_line()` |
| Colors wrong (orange becomes blue) | BGR vs RGB confusion | Use `_hex_to_ass_tag_color()` — never hand-write inline hex |
| Alpha appears fully opaque or transparent | Alpha inversion not applied | Use `_alpha_to_ass(opacity)` — never write raw alpha hex |

## Diagnostic Approach

1. **Isolate the layer**: is the problem in the generated `.ass` file itself, or in how FFmpeg applies it?  
   Extract the `.ass` file from the render pipeline and open it in a player (VLC, mpv) with the same video to confirm.

2. **Check the effect branch**: print `_style_effect_tags(config.base_style)` for the failing config to see which border path was taken.

3. **Check two-layer mode**: if both glow and blur are set, confirm `use_two_layers` is `True` and two Dialogue events appear per line in the file.

4. **Line height debug**: add a temporary `print(line.y, block_height, ink_h, design_h)` in `layout.py` to confirm which height is used for the anchor calculation.

5. **Animation timing**: dump the raw `.ass` event list and verify start/end times are in centiseconds (`H:MM:SS.cc` format, not milliseconds).
