---
name: proto-handoff-prototype
description: Builds app, web app and dashboard prototypes as one self-contained HTML file that follows a machine-readable contract (tokens, components with variants, screens, states and navigation declared in the markup), so the prototype can later be rebuilt in Figma as variables, components, screens made of instances and a clickable prototype with flows. Use it when the user wants a clickable prototype, a mobile or web app prototype, or a prototype "ready for Figma" or "for design handoff", especially when it will be converted with the proto-handoff skill.
license: MIT
metadata:
  author: juanvelasco1
  version: "0.1.2"
  pairs-with: proto-handoff
---

# Handoff-ready prototype — contract v1

This prototype will be converted by a script into a Figma file with variables, components with
variants, screens built from instances, and prototype interactions. The script reads the markup
described below. It never guesses: anything not declared here is lost or rebuilt badly.

Follow every rule. When a rule conflicts with a visual idea, keep the rule and get the visual
another way. The contract constrains structure, not style: the design can look like anything.

Contract attributes all live in the `data-ui` namespace. Never remove, rename or reuse
`data-od-*` attributes: they belong to the editor.

## 1. File and runtime

- One self-contained `.html` file: vanilla HTML, CSS and JavaScript. No React, no Tailwind,
  no CSS-in-JS, no canvas or WebGL for UI. Web fonts from Google Fonts are allowed.
- Deterministic render: no `Math.random()`, no `Date.now()` / `new Date()` in visible content,
  no network requests for content. All mock data lives in one `const DATA = {…}` object.
- The file must render correctly when opened directly with any of the routes in rule 7.

## 2. Tokens

- Every color, spacing, radius, border width, shadow, font family, font size, font weight,
  line height and letter spacing used by components is a CSS custom property declared in
  `:root`. No literal hex, rgb, hsl, px or rem inside component rules.
  Only exception: `0`, `1px` hairlines and `100%`.
- Two layers:
  - Primitives: `--color-<hue>-<step>` (`--color-blue-500`), `--space-<n>`, `--radius-<size>`,
    `--font-size-<px>`, `--font-weight-<name>`, `--line-height-<name>`, `--shadow-<size>`.
  - Semantic, defined only as `var(--primitive)`: `--bg-canvas`, `--bg-surface`,
    `--bg-surface-raised`, `--bg-surface-sunken`, `--text-primary`, `--text-secondary`,
    `--text-tertiary`, `--text-on-accent`, `--border-subtle`, `--border-strong`, `--accent`,
    `--accent-hover`, `--accent-subtle`, `--danger`, `--danger-subtle`, `--success`,
    `--success-subtle`, `--warning`, `--warning-subtle`, `--focus-ring`, `--overlay-scrim`.
    Add more semantic names when needed, always in `--<role>-<variant>` form.
- Component rules use semantic color tokens only, never primitives.
- Spacing scale on a 4 px base: `--space-0` … `--space-16` = 0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64
  (name them `--space-0, -1, -2, -3, -4, -5, -6, -8, -10, -12, -16`).
- Typography roles, each one a class `.type-<role>` built only from tokens:
  `display`, `h1`, `h2`, `h3`, `title`, `body`, `body-sm`, `label`, `caption`, `overline`.
  Every text element uses exactly one `.type-<role>` class.
- Themes: light and dark. Dark redefines only semantic tokens, under
  `:root[data-theme="dark"]`. The theme comes from the route parameter `theme` (rule 7).

## 3. Layout

- Components and sections lay out with flexbox and `gap`. This maps 1:1 to Figma auto layout.
- CSS grid only for page-level layout and uniform card grids, with fixed column counts.
- Sizing is explicit per element: fill (`flex: 1` or `width: 100%`), hug (default) or fixed
  (width from a token).
- `position: absolute` or `fixed` only on elements marked
  `data-ui-layer="overlay|badge|decor|scrim"`.
- Forbidden: negative margins, margins for spacing between siblings (use `gap`), `float`,
  `transform` for layout, `display: contents`, `order`.

## 4. Components

Every reusable UI element is a component. Its root element declares it:

```html
<button data-ui="Button" data-ui-props="variant=primary size=md state=default icon=left">
  <span data-ui-icon="plus"></span>
  <span data-ui-slot="label" class="type-label">New</span>
</button>
```

- `data-ui`: PascalCase name, identical everywhere it appears (`Button`, `IconButton`, `Input`,
  `Select`, `Checkbox`, `Switch`, `Chip`, `Badge`, `Avatar`, `Card`, `ListItem`, `TabBar`,
  `AppBar`, `SegmentedControl`, `Modal`, `BottomSheet`, `Toast`, `EmptyState`, `Skeleton`).
- `data-ui-props`: space-separated `axis=value` pairs, lowercase, kebab-case values. The set of
  axes for a component is the same on every instance. `state` is always one of
  `default|hover|pressed|focus|disabled|error|selected|loading`.
- `data-ui-slot`: text or swappable content inside the component: `label`, `title`,
  `subtitle`, `value`, `helper`, `leading`, `trailing`, `media`.
- Components nest; each keeps its own `data-ui`.
- Screen-specific blocks that are not reusable (a hero, a summary section) are not components:
  mark them `data-ui-section="<name>"`.
- The route `#/_components` renders a gallery with every component in every combination of its
  axes, including every state, grouped by component under a heading with the component name.
  This gallery is the source of truth for Figma variants.

## 5. Icons, images, assets

- Icons: inline SVG from Lucide only, 24×24 viewBox, `stroke="currentColor"`, inside
  `<span data-ui-icon="<lucide-name>">`. Size comes from a token on the span. No icon fonts,
  no emoji as icons, no raster icons.
- Content images: `<img>` with explicit `width` and `height` and `data-ui-image="<purpose>"`
  (`avatar`, `product`, `cover`, `thumbnail`). No content images as CSS `background-image`.
- Logos and illustrations: inline SVG inside `<span data-ui-asset="<name>">`.
- No text rendered inside images.

## 6. Screens

- Mobile: the app renders inside `<div id="device" data-ui-device="390x844">`, exactly that
  size, centered on the page. Desktop web: `<div id="device" data-ui-device="1440x900">`,
  with the page scrolling inside it.
- Each screen's root: `<main data-ui-screen="<flow>/<screen>" data-ui-title="<Human title>">`.
  Ids are kebab-case, e.g. `checkout/payment`. Exactly one screen root is in the DOM at a time
  (overlays are additional, see rule 8).
- Persistent chrome: `data-ui-fixed="top"` (app bar), `data-ui-fixed="bottom"` (tab bar).
  The scrolling region: `data-ui-scroll="vertical"`; carousels: `data-ui-scroll="horizontal"`.

## 7. Routing

- Hash routing is mandatory. Route format:
  `#/<screen-id>?state=<state>&theme=<light|dark>&overlay=<overlay-id>`
  All parameters optional; defaults are `state=default`, `theme=light`, no overlay.
- The app state and the hash stay in sync both ways: navigating updates the hash, and loading
  or changing the hash renders that exact screen, state, theme and overlay with no prior clicks.
  If the prototype keeps an internal `state.route`, it is derived from the hash.
- Entry route `#/` redirects to the first screen of the first flow.

## 8. States

- Every screen that loads, lists, searches or submits data implements, reachable by `?state=`:
  `default` (realistic data), `loading` (skeletons shaped like the content), `empty`, `error`,
  `long-content` (long strings, many items, missing optional fields). Forms add `validation`
  (field errors shown) and `success`.
- The screen root reflects it: `data-ui-screen-state="<state>"`.
- Component-level states (a disabled button, an input with error) are shown through that
  component's `state` prop, never with ad-hoc classes.

## 9. Navigation and interactions

Every interactive element declares its effect:

```html
<button data-ui-nav="checkout/payment" data-ui-nav-type="navigate">Continue</button>
<button data-ui-nav="filters" data-ui-nav-type="overlay">Filters</button>
<button data-ui-nav-type="back">Back</button>
<button data-ui-nav="home/search" data-ui-nav-type="swap">Search</button>
<button data-ui-nav-type="close-overlay">Close</button>
<button data-ui-nav="auth/verify" data-ui-nav-type="navigate"
        data-ui-nav-alt="auth/login?state=validation" data-ui-nav-condition="Invalid credentials">
  Sign in
</button>
```

- `data-ui-nav-type`: `navigate`, `overlay`, `swap` (tabs, segmented controls; same screen
  family), `back`, `close-overlay`, `scroll-to`, `set-state` (changes `?state=` on the same
  screen), `external`, `none` (decorative, explicitly inert).
- `data-ui-nav` holds the target route without `#/`.
- Overlays (modals, bottom sheets, menus, toasts) have a root
  `<div data-ui-overlay="<id>" data-ui-overlay-position="center|bottom|top|anchored">`,
  a scrim marked `data-ui-layer="scrim"`, and are opened by `?overlay=<id>`.
- Decision points declare every outcome with `data-ui-nav-alt` and `data-ui-nav-condition`.
- Only `<button>` and `<a>` are interactive. No clickable `<div>` or `<span>`.
- Every interactive element has one of the attributes above. An interactive element with no
  `data-ui-nav-type` is a contract violation.

## 10. Manifest

At the end of `<body>`, keep a manifest in sync with the screens:

```html
<script type="application/json" id="ui-manifest">
{
  "contract": "handoff-ready/1",
  "name": "Product name",
  "summary": "What the product is and who it is for, in two sentences.",
  "platform": "mobile",
  "device": [390, 844],
  "themes": ["light", "dark"],
  "flows": [
    {
      "id": "checkout",
      "title": "Purchase",
      "start": "cart/review",
      "screens": ["cart/review", "checkout/address", "checkout/payment", "checkout/done"]
    }
  ],
  "screens": {
    "checkout/payment": { "title": "Payment", "states": ["default", "loading", "validation", "error"] }
  },
  "overlays": {
    "filters": { "title": "Filters", "position": "bottom" }
  },
  "glossary": { "Order": "A confirmed purchase of one or more products." }
}
</script>
```

- `platform`: `mobile` or `web`. Every screen in `screens` appears in at least one flow.
- `glossary`: six to twelve product terms, defined in one line each, in the product's language.

## 11. Content and accessibility

- Realistic content in the product's language. No lorem ipsum, no "Item 1, Item 2".
- Contrast WCAG AA in both themes: 4.5:1 body text, 3:1 large text and UI boundaries.
- Touch targets at least 44×44 on mobile.
- Semantic HTML: `<header>`, `<nav>`, `<main>`, `<button>`, `<label for>`, ordered headings.
- Motion is optional; it must stop under `prefers-reduced-motion: reduce`.

## Self-check before finishing

Run through this list and fix every miss before handing back:

1. Opening `#/_components` shows every component and every value of every axis.
2. Opening each route in the manifest, with each declared state, in both themes, renders it
   directly.
3. No literal color, size or spacing inside component rules.
4. Every `<button>` and `<a>` has a `data-ui-nav-type`.
5. No `position: absolute|fixed` without `data-ui-layer`.
6. The manifest lists every screen, overlay and flow present in the file.
