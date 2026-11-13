# OpenSybau — Design System & UI Architecture Guideline (`DESIGN.md`)

## 1. Design Direction & Aesthetic Principles

OpenSybau is an **Operate-mode developer workbench** (`impeccable` Operate standard): high-trust, calm, dense where data demands it, and free of decorative noise. The interface disappears into the engineering task.

- **Earned Familiarity & Spatial Permanence:** Controls stay anchored where muscle memory expects them. Never shift the center stage horizontally when switching views, and never teleport routes without explicit navigation intent.
- **No Nested Border Mazes ("Cards-in-Cards-in-Cards"):** Declare elevation once per group. Separate rows inside a surface using subtle hairlines (`1px solid var(--wb-line-soft)`) or spacing (`12px–16px`), never 3–4 concentric bordered boxes.
- **No Pure `#000000` Default Surfaces:** Even OLED-oriented dark palettes (`obsidian`, `carbon-oled`) use calibrated deep charcoal (`#050608`–`#0b0d12`) with distinct elevated surfaces (`--wb-panel`, `--wb-surface`, `--wb-surface-2`) so card boundaries and logos never vanish into a black void.

---

## 2. CSS Cascade & Token Architecture

### 2.1 Explicit `@layer` Order
All stylesheets participate in a deterministic cascade order declared at the top of the stylesheet entry:

```css
@layer legacy, tokens, base, shell, modules, utilities;
```

- Legacy stylesheets (`feature-views.css`, `legacy-dark-theme.css`) are isolated inside `@layer legacy` so modern token, shell, and module rules win cleanly by layer precedence without `!important` escalation.
- Every `--wb-*` custom property referenced anywhere in CSS **must** be defined in `src/styles/tokens.css` across dark, chromatic, and light themes (`--wb-bg`, `--wb-panel`, `--wb-surface`, `--wb-surface-2`, `--wb-surface-3`, `--wb-control`, `--wb-border`, `--wb-line`, `--wb-line-soft`, `--wb-ink`, `--wb-ink-muted`, `--wb-ink-faint`, `--wb-accent`, `--wb-font-sans`, `--wb-font-mono`).

### 2.2 Semantic Stacking Scale (`z-index`)
Ad-hoc integers (`110`, `220`, `1200`, `9999`) are forbidden. Use only the 6-tier token scale:

| Token | Value | Purpose |
| :--- | :---: | :--- |
| `--wb-z-base` | `1` | Local cell/sticky headers inside scroll containers |
| `--wb-z-sticky` | `20` | Stage toolbars, sticky composer docks, mobile bottom nav |
| `--wb-z-drawer` | `90` | Collapsible/overlay sidebars & right inspector backdrop (`<= 1220px`) |
| `--wb-z-popover` | `160` | Dropdown menus, picker cards, theme menu (must stay `< modal`) |
| `--wb-z-modal` | `240` | `#overlay` modal dialogs, Command Palette (`Ctrl+K`), Setup dialog |
| `--wb-z-toast` | `340` | `#toast` notifications (**always renders above open modals**) |

---

## 3. Typography & Numeric Discipline

- **UI Sans Family (`--wb-font-sans`):** `"Nunito Sans Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`.
- **Code & Data Mono Family (`--wb-font-mono`):** `"Cascadia Code", "JetBrains Mono", Consolas, ui-monospace, monospace`. Inline `:not(pre) > code` **must always** use `--wb-font-mono` with subtle surface tinting — never override inline `<code>` to sans-serif.
- **Weight Discipline:** Restrict font weights to **4 semantic stops**: `400` (Regular body), `500` (Medium UI controls/meta), `600` (SemiBold headings/emphasis), `700` (Bold key metrics).

### Fixed Type Scale (Minimum Floor: `11px`)

| Tier | Token | Size | Weight | Line Height | Tracking | Usage |
| :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| **H1 / Page Title** | `--wb-font-page` | `22px` (`1.375rem`) | `600–650` | `1.25` | `-0.02em` | Top-level page titles, Home hero prompt heading |
| **H2 / Section Header** | `--wb-font-h2` | `17px` (`1.0625rem`) | `600` | `1.30` | `-0.015em` | Settings cards, modal titles, dashboard section headers (including empty states) |
| **H3 / Group Title** | `--wb-font-section` | `15px` (`0.9375rem`) | `600` | `1.35` | `-0.01em` | Sub-sections, role cards, Markdown/Chat `h3` |
| **H4 / Subheading** | `--wb-font-h4` | `13.5px` (`0.8438rem`) | `600` | `1.40` | `0` | Compact card headers, Markdown/Chat `h4` (distinguished from body by `600` weight & `--wb-ink`) |
| **Body Copy** | `--wb-font-body` | `13.5px` (`0.8438rem`) | `400` | `1.60` | `0` | Conversation prose, descriptions, inputs, table cells |
| **Meta / Control** | `--wb-font-meta` | `12px` (`0.75rem`) | `500` | `1.40` | `0` | Buttons, tabs, secondary timestamps, breadcrumbs |
| **Micro / Badge** | `--wb-font-micro` | `11px` (`0.6875rem`) | `600` | `1.25` | `0.02em` | Status pills, shortcut hints, Git badges (**never `< 11px`**) |

- **Tabular Numerals (`font-variant-numeric: tabular-nums`):** Mandatory on all quota percentages, token counters, elapsed timers, diff `+adds / -dels`, stat cards, and numeric table columns.

---

## 4. Component Anatomy Standards

1. **Quota & Progress Bars (Standardized "Used %" Semantics):**
   - Progress/quota bar fill width **always** represents **consumed percentage (`usedPercent`)**, never `remaining%`.
   - Labels must explicitly state direction: `Đã dùng 15% · Còn 85%` (or compact `15% dùng`), with semantic tones: calm accent (`< 75%`), warning amber (`75–89%`), critical red (`>= 90%`).
2. **Data & Markdown Tables:**
   - All tables (`.orca-data-table`, `.md-table`, `.permission-matrix-table`) share unified cell padding (`8px 12px`), `1px solid var(--wb-line)` borders, sticky `<thead>` headers, horizontal scroll wrappers (`max-width: 100%; overflow-x: auto`), right-aligned `tabular-nums` numeric cells, and RFC-4180 quote-aware CSV parsing.
3. **Pipeline & Wave Cards:**
   - Show **one** canonical pipeline representation per view (connected 6-station stepper with visible `.mc-station-line` connectors). Never stack duplicate mini-stations + workflow-lanes inside one card.
4. **Icons & Glyphs:**
   - Render icons exclusively via `Icon.jsx` / `icon(name, size)` from `src/shared/ui/icons.js` across **3 standard sizes**: `14px` (inline/compact pills), `16px` (standard toolbar/buttons/rail), `20px` (empty states & mobile primary nav).
   - Render the OpenSybau mark exclusively via `<BrandLogo />` / `brandLogoSvg()`.
   - Never use raw ASCII `+`, `-`, `✕`, `✓`, `●`, or CSS-border pseudo-icons inside interactive buttons.

---

## 5. Responsive & Platform Breakpoints

- **Viewport Overflow Guard:** `html, body, .wb-app-shell { max-width: 100vw; overflow-x: clip; }`. Off-screen drawers must never expand `document.documentElement.scrollWidth`.
- **Desktop Breakpoints:**
  - `>= 1221px`: Full 3-zone layout (`NavRail` + `ContextSidebar` + `Main Stage` + pinned `RightDock`).
  - `741px – 1220px` (Compact Laptop / Split Window): `RightDock` automatically transitions to an overlay drawer with backdrop so the center chat/code stage retains `>= 520px` breathing room.
  - `<= 740px` (Narrow Desktop Window): Left & Right sidebars operate as mutually exclusive slide-over drawers; Desktop never renders Mobile PC-pairing chrome.
- **Mobile Companion (`html.mobile-companion`):**
  - Driven by runtime platform detection (`isMobileCompanionMode()`), persisting across both portrait (`390x844`) and landscape (`844x390`) orientations.
  - Touch targets meet `>= 40–44px` height; when the soft keyboard opens (`max-height: 540px`), `.wb-mobile-nav` hides and `.home-composer-dock` snaps flush to `bottom: env(safe-area-inset-bottom, 0px)` with zero gap.
