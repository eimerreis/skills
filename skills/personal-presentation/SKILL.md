---
name: personal-presentation
description: Moritz's personal slide-deck style (eimerreis.de brand) as a single-file HTML presentation. Use when building a presentation, pitch, talk, or slide deck for Moritz.
---

# Personal presentation

Single self-contained HTML file in the eimerreis.de brand (direction A): Kobalt and Hitze on Papier, Unbounded headlines, Figtree body, the molten `er` mark cropped large on color slides, flat vector diagrams that reveal click by click.

## Files

- `assets/template.html`: starting point. Brand tokens, inline logo sprite, navigation engine, and six slide patterns: title, section divider, text+graphic split, big statement, numbered timeline, closing.
- `assets/example.html`: full worked deck ("Building eimerreis.de", German, 21 slides). Pattern catalog: copy CSS blocks and markup from here when a slide needs more than the template offers (curve timeline, versus card + fork, notebook, twin graphs, cycle diagram, card chain with loop, house cross-section with legend-driven highlights, struck quote, callout + rising curve, PR mock, book cover + quote, circle of control, branching paths, hitze divider).
- `assets/avatar.png`: Moritz's duotone avatar (Kobalt + Hitze, transparent PNG), used in the title byline and the closing contact line. May be replaced by a new avatar; keep the file name.

## Steps

1. Copy `template.html` (renamed to the topic) and `avatar.png` into the target folder. Set `<title>`, the title slide, and the footer text.
2. Structure the user's notes before designing: sections, each opened by a divider slide. Use the user's own words; restructure and tighten, never pad with invented claims. Flag content you add or interpret.
3. Pick each slide's surface (table below), then give each content slide one graphic idea (diagram, curve, flow, contrast) built as inline SVG or HTML in the brand colors. Anything the speaker talks through point by point gets `step` reveals.
4. Verify every slide visually (see Verification) and fix overflow, clipping, overlaps, and contrast before handing back. Done when every slide has been screenshotted fully revealed at 1920×1080 and 1280×720 and looks clean.

## Style rules

- Palette (CSS vars as RGB triples, use `rgb(var(--x))` / `rgb(var(--x) / .2)`; inside SVG attributes write the literal `rgb(...)`):

  | Token | RGB | Role |
  |---|---|---|
  | `--papier` | 247 243 232 | canvas |
  | `--surface` | 255 253 248 | cards on papier |
  | `--sunken` | 238 232 217 | tracks, wells |
  | `--tinte` | 17 17 17 | text, structure lines |
  | `--muted` | 94 88 77 | secondary text, axis labels |
  | `--rule` / `--rule-strong` | 221 213 195 / 160 151 133 | hairlines, axes / dashed outlines |
  | `--kobalt` | 22 75 255 | primary fill; headlines and text on papier |
  | `--hitze` | 255 106 43 | contrast fill, emphasis; text on it is tinte |
  | `--hitze-text` | 178 58 8 | hitze as text or thin line on papier |

- Contrast pairs that pass: papier on kobalt, tinte on hitze, kobalt or hitze-text on papier. Hitze text on kobalt and papier text on hitze fail; keep those pairs for large decorative shapes only.
- Surfaces (`data-surface` on the `<section>`; the engine recolors the lockup and footer to match):
  - Title, statement, closing: `kobalt`, papier text, big cropped mark (`.bigmark`, hitze on the title, papier elsewhere).
  - Section divider: `kobalt` or `hitze` full-bleed, heading only. A chapter number (`01 — Ausgangslage`) only when the order helps the audience.
  - Content: papier (no attribute). Headline `h2` in kobalt, supporting text in `p.lead`.
- Diagram color roles: kobalt = calm, positive, expected; hitze = emphasis, problem, the thing to notice; tinte = structure (outlines, beams, axes ink), rule colors for axes and inactive parts. Hitze as a fill or a stroke ≥4 units; its labels in hitze-text.
- Type: headlines Unbounded 700, tracking -0.02 to -0.03em, sentence case. Body and SVG labels Figtree (500–700). Emphasis by weight, size, or the `.hl` highlighter (hitze fill, tinte text).
- Shapes: cards `.card` (surface, 1px rule border, ~1.3vh radius); elevation is a border or a soft offset shadow, one per element. Pills only for small tags. Bullets and markers are CSS dots or drawn SVG.
- Headings stand alone: content slides open with the `h2`, no label line above it.
- Sizes in `vh`/`vw` only, so slides scale with the window and fullscreen. Unbounded runs wide: long headlines get `max-width` in `ch` and `&shy;` in compounds.
- Chrome stays minimal: `eimerreis.` lockup top-left on every slide, deck title bottom-right on papier slides only. No slide counter, no progress dots.
- Language of slide text follows the user (often German); code, comments and class names in English.

## Engine (in template)

- Navigation: →/Space/click right = next, ←/click left third = back, Home/End, `F` toggles fullscreen. URL hash holds the slide number (`#7`).
- `.rise`: entrance animation for direct children of a slide, staggered. Reduced motion turns off rise, reveals' transitions, and looping animations.
- `.step`: hidden until revealed by a click; next-click reveals the next step, back hides it. Order is DOM order unless `data-order="n"` is set. Going back into a slide shows all its steps.
- `path.draw` with `pathLength="1"`: the line draws itself when it (or its parent `.step`) is shown. No `vector-effect="non-scaling-stroke"` on these paths: it breaks the dash trick.
- Tie a non-step element to a step with `:has()`, e.g. `.my-slide:has(.leg-a.shown) .floor-a { fill: … }` (highlight a diagram region when its legend item appears). Use this instead of making both elements steps, which would cost two clicks.
- Logo: one hidden SVG sprite with `#er-mark`, `#er-mark-compact` (below ~40px) and `#er-lockup`; use as `<svg viewBox="0 0 487.8 320.5"><use href="#er-mark"/></svg>`, color via `fill` (mark) or `--logo-mark` / `--logo-word` (lockup).

## Verification

Headless Chrome screenshots at 1920×1080 and 1280×720 of a temporary copy with all steps forced visible and animations off:

```sh
mkdir -p /tmp/shots && cp avatar.png *.jpg /tmp/shots/ 2>/dev/null
sed 's|</style>|.step{opacity:1!important;transform:none!important} path.draw{stroke-dashoffset:0!important;opacity:1!important;transition:none!important} *{animation:none!important}</style>|; s|  show(i);$|  show(i, true);|' deck.html > /tmp/shots/all.html
chrome --headless --no-sandbox --disable-gpu --hide-scrollbars \
  --window-size=1920,1080 --virtual-time-budget=4000 --screenshot=/tmp/shots/s7.png "file:///tmp/shots/all.html#7"
```

`chrome` = the Chrome binary (macOS: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`; Linux: a Playwright `chrome-headless-shell`). `show(i, true)` marks every step `shown`, so `:has(.x.shown)` highlights render too. Screenshot the unmodified file as well for each slide's initial state.

## Gotchas

- Images (avatar, covers) are relative paths: they must sit next to the HTML file. Tell the user.
- Fonts load from Google Fonts; offline they fall back to system fonts and Unbounded's width is lost, so check line breaks online.
- Long SVG labels clip at the viewBox edge: widen the viewBox or wrap with `<tspan>`.
- Book covers and other external images: download them into the deck folder (headless Chrome `--dump-dom` gets past bot checks that block curl).
