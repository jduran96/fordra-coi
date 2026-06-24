# Fordra Website — Design Handoff

> Single source of truth for the Fordra marketing site's visual direction. If you're
> an agent or dev touching this site, read this first and fold it into your own plan.
> Last updated by the concept pass on branch `website-krida-concept`.

---

## 1. What this branch is

`website-krida-concept` is a **design concept** that re-skins the existing Fordra
landing page in a "Krida-inspired" aesthetic (modeled on https://krida.ai). Content,
structure, and all interactive JS (modal, form validation, phone formatting, localhost
nav-rewrite) are unchanged from the `website` branch — only the **look** changed.

It is a concept, not a merge candidate yet. `main` and `website` are untouched.

### Files

| File | Role |
|------|------|
| `tokens.css` | Design tokens (color, type, spacing, radii, shadow, motion). **Edit design here first.** |
| `styles.css` | Component styles, all referencing tokens. No hard-coded colors except a few rgba shadows/rings. |
| `index.html` | Markup + Google Fonts link + inline nav-rewrite script. |
| `main.js` | Modal + form logic. **Do not rename the classes/IDs it depends on** (see §6). |

---

## 2. What changed in this pass

1. **Palette swap** — replaced the old terracotta/navy editorial theme with Krida's
   warm cream + warm near-black + electric-lime system (see §3).
2. **Typography swap** — old DM Serif Display + Inter → **Newsreader** (serif display) +
   **Hanken Grotesk** (sans body) + **JetBrains Mono** (labels). See §4.
3. **Signature Krida moves added** — lime highlighter-marker behind hero word, pill
   buttons, big soft rounded cards in a 2×2 grid, a dark `#141413` CTA band, mono
   eyebrow labels, a hero stats row, lime focus-rings. See §5.
4. **Copy cleanup** — removed all em-dashes and AI-tell phrasing (see §7). Keep it that way.

---

## 3. Color system (the Krida palette)

Defined as tokens in `tokens.css`. **Always use the token, never the raw hex.**

| Token | Value | Use |
|-------|-------|-----|
| `--color-paper` | `#faf9f5` | Main page background (warm cream) |
| `--color-cream` | `#f2efea` | Subtle block fills, hover states, icon chips |
| `--color-surface` | `#ffffff` | Cards, modal |
| `--color-ink` | `#141413` | Primary text, dark panels, dark buttons (warm near-black, **not** pure `#000`) |
| `--color-ink-soft` | `#2a2926` | Dark-button hover |
| `--color-lime` | `#d4fd8e` | **Signature accent** — CTA fills, hover accents, focus rings, icon-chip hover |
| `--color-lime-deep` | `#c2f06f` | Lime hover/pressed |
| `--color-marker` | `#d8fca6` | Highlighter underline behind emphasized words |
| `--color-text-secondary` | `#57544e` | Body copy |
| `--color-text-tertiary` | `#7e7e7e` | Muted labels |
| `--color-text-muted` | `#a6a4a0` | Placeholders, card numbers |
| `--color-border` | `rgba(20,20,19,0.12)` | Hairline borders (warm-black alpha, not gray) |
| `--color-on-dark` / `--color-on-dark-muted` | `#faf9f5` / `#a6a4a0` | Text on dark panels |

**Accent discipline:** lime is a spotlight, not a fill. Use it for one CTA per view,
hover feedback, focus rings, and the highlighter marker. Don't tint large areas lime.

---

## 4. Typography

Loaded via one Google Fonts `<link>` in `index.html`. Tokens: `--font-display`,
`--font-body`, `--font-mono`.

| Role | Font | Where | Notes |
|------|------|-------|-------|
| Display | **Newsreader** (serif) | h1, section titles, card h2, CTA h2, modal h3, logo | High-contrast modern serif. Use light weights (**320–400**), tight tracking (`-0.02 to -0.03em`). `font-optical-sizing: auto`. |
| Body / UI | **Hanken Grotesk** (sans) | paragraphs, nav, buttons, inputs | Weights 400–700. |
| Label | **JetBrains Mono** | eyebrows (`.eyebrow`), card numbers, stat captions | Uppercase, `letter-spacing: 0.14em`, `--text-xs`. |

> **Font-substitution note:** Krida ships licensed **Signifier** (serif) + **Beausite
> Classic** (sans). Those aren't freely licensable, so Newsreader/Hanken are the closest
> free stand-ins. If Fordra licenses the real fonts, swap the two `--font-*` tokens and
> the `<link>` — nothing else needs to change.
>
> A previous iteration used **Fraunces** for display; it was rejected because its `ff`
> ligature renders wonky ("Offload"). **Do not reintroduce Fraunces.** If you ever try
> another quirky serif, check the `ff`/`fi` ligatures first.

---

## 5. Signature design moves (carry these into the app)

These are what make it read as "Krida." Reuse them when building new pages/components.

- **Highlighter marker** — emphasized hero word gets a lime marker *behind* the text,
  not colored text. Implemented as a `linear-gradient` band on `.highlight` (see
  `styles.css`), so it sits behind descenders cleanly. Italic + serif for the marked word.
- **Pill buttons** — `border-radius: var(--radius-full)`. Three variants:
  `.btn` (dark, default), `.btn-lime` (lime fill + ink text, the primary CTA),
  `.btn-ghost` (outline). All lift 1px on hover.
- **Big soft rounded cards** — `--radius-lg` (24px), white surface, warm hairline border,
  lift + soft shadow + cream fill on hover, lime icon-chip on hover.
- **Dark CTA panel** — full `--color-ink` block, `--radius-xl` (36px), lime eyebrow,
  oversized light-weight serif headline. Krida's recurring rhythm: alternate cream and
  dark sections down the page.
- **Mono eyebrows** — every section opens with a small uppercase mono `.eyebrow` label.
- **Soft deep shadows** — `--shadow-md` / `--shadow-lg`, never harsh.
- **Lime focus ring** — inputs/buttons focus with a `rgba(212,253,142,…)` ring.
- **Generous radii & whitespace** — round, airy, confident. Radii scale:
  `sm 10 · md 16 · lg 24 · xl 36 · full`.

---

## 6. Do-not-break contracts (JS dependencies)

`main.js` selects these by class/ID. Renaming any of them breaks the modal/form:

- IDs: `#modal`, `#contact-form`, `#field-name`, `#field-email`, `#field-phone`,
  `#err-email`, `#err-phone`, `#modal-success`
- Classes: `.modal`, `.phone-input`, `.invalid`, `.visible`, `.open`
- Inline handlers in HTML: `openModal()`, `closeModal()`, `closeOnOverlay(event)`
- The nav-rewrite `<script>` in `index.html` repoints `.nav-links a` to `localhost:3000`
  when previewing locally; keep the `data-path` attributes on nav links.

---

## 7. Copy rules (keep it human)

- **No em-dashes** (`—`), en-dashes (`–`), or `&mdash;`/`&ndash;` entities — anywhere,
  including code comments. Use commas, colons, or full stops.
- **No AI-tell phrasing.** Avoid antithesis fillers ("in seconds, not hours"),
  buzz-phrases ("on autopilot", "supercharge", "seamless", "unlock"), and over-punchy
  marketing clichés. Plain, specific, operator-friendly language only.
- The product legitimately uses AI — describing that ("use AI to validate carrier
  insurance") is fine. The rule is about *writing style*, not the word "AI."

---

## 8. Running it locally

Static site, no build step.

```bash
python3 -m http.server 8800   # then open http://localhost:8800/
```

(`.claude/launch.json` also defines a `fordra-dev` config on port 8080.)

---

## 9. Status & next steps

- **Done:** landing page reskin + copy cleanup on `website-krida-concept`. Not committed
  unless you see a commit after this note; `main`/`website` untouched.
- **If continuing:** apply §3–§5 to the app (`app.fordra.com`) and the demo/admin pages
  for a consistent system. Start by porting `tokens.css` as the shared token layer.
- **Open question for the owner:** whether to license Signifier + Beausite for an exact
  Krida match (§4), or ship with Newsreader/Hanken.

---

## Note on cleanup

There were **no other plan or agent-instruction files** in this repo to remove
(no `CLAUDE.md`, `AGENTS.md`, or stray `*plan*` docs). `.claude/launch.json` and
`.claude/settings.local.json` are tooling config, not plans, and were left in place.
This file is intended to be the only standing design-handoff doc.
