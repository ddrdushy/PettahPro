# PettahPro — UI System

> The design system specification. Design tokens, component library, layout patterns, responsive grid, and accessibility foundations. This is what engineering references when building components. It's derived from the brand kit and forms the technical foundation for every screen in the product. Scope: Sri Lanka only.

---

## Table of Contents

1. [Design tokens](#1-design-tokens)
2. [Spacing system](#2-spacing-system)
3. [Responsive grid and breakpoints](#3-responsive-grid-and-breakpoints)
4. [Component library — primitives](#4-component-library--primitives)
5. [Component library — compositions](#5-component-library--compositions)
6. [Layout patterns](#6-layout-patterns)
7. [Page shell](#7-page-shell)
8. [States and feedback](#8-states-and-feedback)
9. [Motion and transitions](#9-motion-and-transitions)
10. [Accessibility foundations](#10-accessibility-foundations)
11. [Dark mode (Phase 2)](#11-dark-mode-phase-2)
12. [System maintenance](#12-system-maintenance)

---

## 1. Design tokens

Design tokens are the atomic design decisions exposed as named values. All UI references tokens, never raw values. This enables consistent rendering and future theming (dark mode, white-label, etc.).

### 1.1 Color tokens

Full color system from brand kit, expressed as CSS custom properties.

```css
:root {
  /* Brand primary */
  --color-charcoal: #1A1A1A;
  --color-mint: #7FB89A;
  --color-mint-dark: #3D6B52;
  --color-off-white: #FAFAF9;
  --color-mint-surface: #E8EDE9;

  /* Text */
  --color-text-primary: #1A1A1A;
  --color-text-secondary: #5F5E5A;
  --color-text-tertiary: #888780;
  --color-text-disabled: #B4B2A9;
  --color-text-inverse: #FAFAF9;
  --color-text-on-mint: #3D6B52;

  /* Backgrounds */
  --color-bg-primary: #FAFAF9;
  --color-bg-secondary: #E8EDE9;
  --color-bg-elevated: #FFFFFF;
  --color-bg-recessed: #F1EFE8;

  /* Borders */
  --color-border-subtle: #E5E5E3;
  --color-border-default: #D3D1C7;
  --color-border-emphasis: #888780;
  --color-border-focus: #1A1A1A;

  /* Semantic */
  --color-success: var(--color-mint-dark);
  --color-success-bg: var(--color-mint-surface);
  --color-success-border: var(--color-mint);

  --color-warning: #B47A15;
  --color-warning-bg: #FAF0D9;
  --color-warning-border: #E3A72F;

  --color-danger: #A53C2D;
  --color-danger-bg: #F7E7E4;
  --color-danger-border: #C44536;

  --color-info: #2C4A5E;
  --color-info-bg: #E7ECEF;
  --color-info-border: #6B8DA8;

  /* Interactive */
  --color-primary: var(--color-charcoal);
  --color-primary-hover: #2D2D2B;
  --color-primary-active: #404040;

  --color-accent: var(--color-mint);
  --color-accent-hover: #6FA88A;
  --color-accent-active: var(--color-mint-dark);

  /* Chart palette */
  --chart-1: #3D6B52;
  --chart-2: #B47A15;
  --chart-3: #2C4A5E;
  --chart-4: #8B5E83;
  --chart-5: #6B7F3D;
  --chart-6: #A53C2D;
}
```

### 1.2 Typography tokens

```css
:root {
  /* Font families */
  --font-sans: 'Inter', 'Noto Sans Sinhala', 'Noto Sans Tamil', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --font-mono: 'JetBrains Mono', 'Menlo', monospace;

  /* Font sizes */
  --text-display: 44px;
  --text-h1: 32px;
  --text-h2: 22px;
  --text-h3: 18px;
  --text-h4: 16px;
  --text-body-lg: 16px;
  --text-body: 14px;
  --text-small: 13px;
  --text-caption: 12px;
  --text-micro: 11px;

  /* Font weights */
  --weight-regular: 400;
  --weight-medium: 500;

  /* Line heights */
  --leading-tight: 1.15;
  --leading-snug: 1.35;
  --leading-normal: 1.5;
  --leading-relaxed: 1.6;

  /* Letter spacing */
  --tracking-tight: -0.01em;
  --tracking-normal: 0;
  --tracking-wide: 0.02em;
  --tracking-caps: 0.06em;
}
```

### 1.3 Border radius tokens

```css
:root {
  --radius-none: 0;
  --radius-sm: 4px;     /* badges, pills, small tags */
  --radius-md: 8px;     /* buttons, inputs, small cards */
  --radius-lg: 12px;    /* cards, modals, large containers */
  --radius-xl: 16px;    /* feature cards, hero elements */
  --radius-full: 9999px; /* circular avatars, toggle switches */
}
```

### 1.4 Border width tokens

```css
:root {
  --border-width-hairline: 0.5px;
  --border-width-default: 1px;
  --border-width-emphasis: 2px;
  --border-width-focus: 2px;
}
```

### 1.5 Shadow tokens

Flat design philosophy — shadows are minimal and only functional.

```css
:root {
  --shadow-none: none;
  --shadow-focus: 0 0 0 3px rgba(26, 26, 26, 0.15);
  --shadow-focus-mint: 0 0 0 3px rgba(127, 184, 154, 0.3);
  --shadow-dropdown: 0 4px 12px rgba(26, 26, 26, 0.08);
  --shadow-modal: 0 8px 24px rgba(26, 26, 26, 0.12);
}
```

**Rule**: No decorative shadows. No `box-shadow` on cards in their default state. No glow, no emboss, no elevation layers mimicking Material Design.

### 1.6 Z-index scale

```css
:root {
  --z-base: 0;
  --z-dropdown: 100;
  --z-sticky: 200;
  --z-overlay: 300;
  --z-modal: 400;
  --z-popover: 500;
  --z-toast: 600;
  --z-tooltip: 700;
}
```

### 1.7 Transition tokens

```css
:root {
  --transition-instant: 75ms ease-out;
  --transition-fast: 150ms ease-out;
  --transition-normal: 200ms ease-out;
  --transition-slow: 300ms ease-out;

  /* Specific use */
  --transition-button: background-color var(--transition-fast), color var(--transition-fast), border-color var(--transition-fast);
  --transition-input: border-color var(--transition-fast), box-shadow var(--transition-fast);
}
```

---

## 2. Spacing system

### 2.1 Base unit

**8-point grid** — all spacing uses multiples of 4px (half step) or 8px (full step).

### 2.2 Spacing tokens

```css
:root {
  --space-0: 0;
  --space-0-5: 2px;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;
  --space-16: 64px;
  --space-20: 80px;
  --space-24: 96px;
  --space-32: 128px;
}
```

### 2.3 Spacing application guide

| Space | Typical use |
|---|---|
| 4px | Within micro-components (icon-text gap in a button) |
| 8px | Between closely related items (icon and label, tag items) |
| 12px | Between form fields, between list items in a dense list |
| 16px | Default padding inside cards, gap between sibling elements |
| 24px | Between sections within a card, gap between cards |
| 32px | Between major page sections |
| 48px | Top padding of major page areas |
| 64px | Between page hero and content |

### 2.4 Rule of rhythm

Vertical rhythm follows 8px base; horizontal spacing is more flexible but generally follows the scale.

**Don't**:
- Use arbitrary values like 7px, 13px, 15px
- Use 6px except in rare tight layouts (never as a primary spacing)
- Use 10px — use 8px or 12px instead

---

## 3. Responsive grid and breakpoints

### 3.1 Breakpoints

```css
:root {
  --breakpoint-sm: 640px;   /* Mobile landscape, small tablets */
  --breakpoint-md: 768px;   /* Tablets */
  --breakpoint-lg: 1024px;  /* Small laptops */
  --breakpoint-xl: 1280px;  /* Desktops */
  --breakpoint-2xl: 1536px; /* Large desktops */
}
```

### 3.2 Grid system

- **12-column grid** at desktop (lg+)
- **Gutter**: 24px at desktop, 16px at tablet, 12px at mobile
- **Max content width**: 1280px (for marketing pages), 1440px (for dashboard pages with sidebar)
- **Container padding**: 32px at desktop, 24px at tablet, 16px at mobile

### 3.3 Responsive behavior

| Breakpoint | Dashboard | Marketing | Tables |
|---|---|---|---|
| Mobile (<640px) | Single column, collapsible sidebar → hamburger + drawer | Single column stack | Card-list alternative view |
| Tablet (640-1024px) | Sidebar collapses to icon-only rail | Two-column where sensible | Horizontal scroll within container |
| Desktop (1024-1280px) | Full sidebar + main | Full layouts | Native table |
| Large (1280+) | Full sidebar + main + optional right panel | Capped at max-width, centered | Native table with more columns visible |

### 3.4 Mobile-first strategy

Write CSS mobile-first:

```css
/* Mobile default */
.sidebar { display: none; }

/* Tablet+ */
@media (min-width: 768px) {
  .sidebar { display: block; width: 64px; } /* icon-only rail */
}

/* Desktop+ */
@media (min-width: 1024px) {
  .sidebar { width: 240px; } /* full sidebar */
}
```

### 3.5 Mobile-optimized vs desktop-only screens

Not every screen needs full mobile parity. Prioritization:

| Screen | Mobile priority | Reason |
|---|---|---|
| Login / signup | ✅ Must be perfect on mobile | Entry point |
| Dashboard | ✅ Must be readable on mobile | Owners check on phone |
| POS | ❌ Designed for register tablet (10"+) | Not used on phones |
| Invoice creation | ✅ Simplified mobile version | Field sales create invoices on phone |
| Invoice list | ✅ Card-list view on mobile | Common reference |
| Approvals (leave, expense, PO, payment) | ✅ Core mobile use case | Owners approve on the go |
| Customer/supplier lookup | ✅ Essential on mobile | Field staff |
| Bank reconciliation | ❌ Desktop only — too complex | OK to direct users to desktop |
| Period close | ❌ Desktop only | OK — monthly task |
| Payroll run | ❌ Desktop only | OK — monthly task |
| Reports | ⚠️ View-only on mobile, no editing | Charts readable on mobile |
| Settings | ✅ Full mobile support | Admin on the go |

---

## 4. Component library — primitives

Medium-depth specs. Each component lists: purpose, variants, states, dimensions, key properties, accessibility requirements.

### 4.1 Buttons

**Purpose**: Trigger actions.

**Variants**:
- Primary — charcoal fill, primary CTA
- Accent — mint fill, used only for key brand moments (not generic primary)
- Secondary — outline, default secondary actions
- Ghost — no border, used in tight spaces and toolbars
- Destructive — danger color, irreversible actions

**Sizes**:
- Small: 28px height, 12px 8px padding, 13px text
- Default: 36px height, 16px 10px padding, 14px text
- Large: 44px height, 20px 12px padding, 16px text
- XLarge: 56px height, 24px 16px padding, 18px text (POS "Pay" button only)

**States**: default, hover, active, focus, disabled, loading

**Key properties**:
```css
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-family: var(--font-sans);
  font-weight: var(--weight-medium);
  border-radius: var(--radius-md);
  border: var(--border-width-default) solid transparent;
  transition: var(--transition-button);
  cursor: pointer;
  white-space: nowrap;
  min-width: 80px;
}

.btn-primary {
  background: var(--color-primary);
  color: var(--color-text-inverse);
  border-color: var(--color-primary);
}
.btn-primary:hover { background: var(--color-primary-hover); }
.btn-primary:active { background: var(--color-primary-active); }
.btn-primary:focus-visible { box-shadow: var(--shadow-focus); }

.btn-secondary {
  background: transparent;
  color: var(--color-text-primary);
  border-color: var(--color-border-default);
}
.btn-secondary:hover {
  background: var(--color-bg-secondary);
  border-color: var(--color-border-emphasis);
}

.btn-accent {
  background: var(--color-accent);
  color: var(--color-text-on-mint);
  border-color: var(--color-accent);
}
.btn-accent:hover { background: var(--color-accent-hover); }

.btn-ghost {
  background: transparent;
  color: var(--color-text-primary);
  border-color: transparent;
}
.btn-ghost:hover { background: var(--color-bg-secondary); }

.btn-destructive {
  background: var(--color-danger-accent);
  color: white;
  border-color: var(--color-danger-accent);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  pointer-events: none;
}
```

**Icon buttons**: Same dimensions minus text padding. 36px square default. Always include `aria-label`.

**Accessibility**:
- Minimum 44×44px touch target on mobile (use `padding` to achieve if button looks smaller)
- `aria-label` required on icon-only buttons
- Loading state must be announced via `aria-busy="true"`
- Never disable a button without explaining why (tooltip on disabled button explaining the reason)

### 4.2 Inputs

**Purpose**: Collect user data.

**Variants**:
- Text input (single line)
- Textarea (multi-line)
- Number input
- Email, phone, password inputs
- Search input (with embedded icon)

**Sizes**:
- Small: 32px height
- Default: 40px height
- Large: 48px height

**States**: default, hover, focus, disabled, error, success, read-only

**Key properties**:
```css
.input {
  width: 100%;
  padding: 8px 12px;
  font-family: var(--font-sans);
  font-size: var(--text-body);
  font-weight: var(--weight-regular);
  color: var(--color-text-primary);
  background: var(--color-bg-elevated);
  border: var(--border-width-hairline) solid var(--color-border-default);
  border-radius: var(--radius-md);
  transition: var(--transition-input);
}

.input::placeholder { color: var(--color-text-tertiary); }
.input:hover { border-color: var(--color-border-emphasis); }
.input:focus {
  outline: none;
  border-color: var(--color-charcoal);
  box-shadow: 0 0 0 3px rgba(26, 26, 26, 0.1);
}
.input:disabled {
  background: var(--color-bg-recessed);
  color: var(--color-text-disabled);
  cursor: not-allowed;
}
.input--error {
  border-color: var(--color-danger-accent);
}
.input--error:focus {
  box-shadow: 0 0 0 3px rgba(196, 69, 54, 0.2);
}
```

**Labels**: Always above the input, never inside (placeholder is not a label).

**Helper text / errors**: Appear below input, 13px text, `--color-text-secondary` for helper, `--color-danger` for errors.

**Accessibility**:
- Every input has a `<label>` associated via `for`/`id`
- Error messages use `aria-describedby` and `aria-invalid="true"`
- Required fields marked with `aria-required="true"` + visible `*` indicator

### 4.3 Select / Dropdown

**Purpose**: Choose one option from a list.

**Variants**:
- Native `<select>` (used for simple, short lists)
- Custom dropdown (searchable, used for customers/items/accounts)

**Native select dimensions**: Same as text input (40px default height).

**Custom dropdown**:
- Trigger looks identical to text input with a chevron icon on the right
- Opens a panel below (or above if no room below)
- Panel: `--shadow-dropdown`, `--radius-md`, max-height 320px with scroll
- Search input at top of panel when option count > 10
- Options: 36px height, left-aligned, hover state `--color-bg-secondary`
- Selected state: mint checkmark on right

**Accessibility**:
- Combobox pattern (`role="combobox"` with `aria-expanded`, `aria-controls`)
- Arrow key navigation
- Escape closes panel
- Screen reader announces total options and current position

### 4.4 Checkbox

**Dimensions**: 18×18px at default, 24×24px when standalone.

**States**: unchecked, checked, indeterminate, disabled, hover, focus.

**Key properties**:
```css
.checkbox {
  width: 18px;
  height: 18px;
  border: var(--border-width-hairline) solid var(--color-border-default);
  border-radius: var(--radius-sm);
  background: var(--color-bg-elevated);
  cursor: pointer;
  transition: var(--transition-fast);
}

.checkbox:checked {
  background: var(--color-charcoal);
  border-color: var(--color-charcoal);
}
/* Check mark via ::after with SVG check icon in white */

.checkbox:indeterminate {
  background: var(--color-charcoal);
  border-color: var(--color-charcoal);
}
/* Dash mark via ::after */

.checkbox:focus-visible {
  box-shadow: var(--shadow-focus);
}
```

**Label**: To the right of checkbox, 8px gap. Whole row clickable.

### 4.5 Radio

Same specs as checkbox but fully rounded (`--radius-full`). Filled center dot on selected state.

### 4.6 Toggle switch

**Purpose**: Binary on/off controls.

**Dimensions**: 36px wide × 20px tall at default size.

**Key properties**:
```css
.toggle {
  width: 36px;
  height: 20px;
  background: var(--color-border-default);
  border-radius: var(--radius-full);
  position: relative;
  cursor: pointer;
  transition: var(--transition-fast);
}

.toggle::after {
  content: '';
  width: 16px;
  height: 16px;
  background: white;
  border-radius: var(--radius-full);
  position: absolute;
  top: 2px;
  left: 2px;
  transition: var(--transition-fast);
}

.toggle--on {
  background: var(--color-charcoal);
}
.toggle--on::after {
  left: 18px;
}
```

**Use**: for settings that apply immediately (no Save button needed). For form fields requiring explicit submission, use a checkbox.

### 4.7 Date picker

**Purpose**: Select a date.

**Trigger**: Same as input — 40px height, calendar icon on right.

**Panel**: Opens below, month/year nav, 7-day grid, mint ring around today, mint fill on selected date.

**Key properties**:
- Week starts Monday (SL convention)
- Date format: `DD/MM/YYYY`
- Keyboard-navigable (arrow keys move by day, PageUp/PageDown by month)
- "Today" button shortcut
- Date range variant: two panels side-by-side, click-drag to select range

### 4.8 Combobox / Autocomplete

**Purpose**: Search-as-you-type from a large list (customers, items, accounts).

**Behavior**:
- Filter options as user types
- Highlight matched substring in bold
- Show recent items first if nothing typed
- "No results" state with CTA: "+ Add new customer"

**Dimensions**: Same as text input (40px default).

### 4.9 Tags / Pills / Badges

**Purpose**: Small labels for status, category, or attribute.

**Sizes**:
- Small: 20px height, 10px horizontal padding, 11px text
- Default: 24px height, 12px horizontal padding, 12px text

**Variants**:
- Neutral: `--color-bg-secondary` background, `--color-text-primary` text
- Success: `--color-success-bg` background, `--color-success` text
- Warning: `--color-warning-bg` background, `--color-warning` text
- Danger: `--color-danger-bg` background, `--color-danger` text
- Info: `--color-info-bg` background, `--color-info` text
- Outlined: transparent background, border

**Dismissible variant**: Small × icon on right, 4px from text.

### 4.10 Avatars

**Purpose**: Represent a person or entity.

**Sizes**:
- Small: 24×24px
- Default: 32×32px
- Medium: 40×40px
- Large: 48×48px
- XLarge: 64×64px

**Variants**:
- Photo (if uploaded)
- Initials (first + last name initials, max 2 characters)
- Icon (for system/integration avatars)

**Initials fallback**:
- Background: deterministic mint variant based on name hash (all from our palette)
- Text: 500 weight, sized ~40% of avatar size
- Color: `--color-text-on-mint`

### 4.11 Tooltips

**Purpose**: Contextual help on hover/focus.

**Trigger**: Any element with a `tooltip` attribute or wrapped in a `<Tooltip>` component.

**Behavior**:
- Appears after 400ms delay on hover
- Appears immediately on keyboard focus
- Positioned above trigger by default, flip to below if no room

**Dimensions**:
- Max width: 240px
- Padding: 6px 10px
- Font size: 12px
- Line height: 1.4

**Colors**:
- Background: `--color-charcoal`
- Text: `--color-off-white`
- No border
- `--radius-md`
- Subtle arrow pointing at trigger

### 4.12 Progress indicators

**Variants**:
- Linear progress bar (thin — 4px)
- Circular progress (20px for inline, 40px for empty-state)
- Stepper (for wizards — see compositions)

**Linear progress**:
```css
.progress {
  width: 100%;
  height: 4px;
  background: var(--color-bg-secondary);
  border-radius: var(--radius-full);
  overflow: hidden;
}
.progress__fill {
  height: 100%;
  background: var(--color-mint);
  transition: width 300ms ease-out;
}
```

**Indeterminate progress**: shimmer animation in mint.

### 4.13 Loading / Skeleton

**Skeleton blocks**: Placeholder shapes shown while content loads.

```css
.skeleton {
  background: var(--color-bg-secondary);
  border-radius: var(--radius-md);
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
```

Apply to:
- Table rows (show 5 skeleton rows of the right height)
- Card content
- Chart areas

**Avoid spinners** for >1s loading. Use skeletons (feels faster, shows structure).

### 4.14 Dividers

**Horizontal**: `<hr>` replaced with:
```css
.divider {
  height: 0.5px;
  background: var(--color-border-subtle);
  border: none;
  margin: 16px 0;
}
```

Vertical divider: same specs, rotated.

**Text dividers** (e.g., "or" between form sections):
- Horizontal line
- Centered text on line, with 16px padding on either side
- Text: 12px, text-secondary

---

## 5. Component library — compositions

Higher-level components composed of primitives.

### 5.1 Cards

**Purpose**: Group related content.

**Variants**:
- Default card: white background, 0.5px border, 12px radius, 16px padding
- Metric card: secondary background, no border (used for dashboard KPIs)
- Interactive card: default + hover state with mint border
- Bordered-left accent: left border 3px mint/warning/danger to signal category

**Spec**:
```css
.card {
  background: var(--color-bg-elevated);
  border: var(--border-width-hairline) solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  padding: var(--space-4);
}

.card--metric {
  background: var(--color-bg-secondary);
  border: none;
  padding: var(--space-4);
  border-radius: var(--radius-md);
}

.card--interactive {
  cursor: pointer;
  transition: var(--transition-fast);
}
.card--interactive:hover {
  border-color: var(--color-mint);
}
```

**Card header**:
- 16px header padding
- Title: H3 (18px, 500)
- Optional subtitle: body-small (13px, text-secondary)
- Optional trailing action: link or small button

### 5.2 Tables

**Purpose**: Display structured rows of data.

**Core spec**:
```css
.table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-body);
}

.table th {
  text-align: left;
  font-weight: var(--weight-medium);
  color: var(--color-text-secondary);
  padding: var(--space-3) var(--space-4);
  border-bottom: var(--border-width-hairline) solid var(--color-border-default);
  font-size: var(--text-small);
  text-transform: none;
}

.table td {
  padding: var(--space-3) var(--space-4);
  border-bottom: var(--border-width-hairline) solid var(--color-border-subtle);
  vertical-align: middle;
  height: 48px;
}

.table tr:hover td {
  background: var(--color-bg-secondary);
}

.table tr:last-child td {
  border-bottom: none;
}

/* Numeric alignment */
.table td--numeric,
.table th--numeric {
  text-align: right;
  font-feature-settings: 'tnum';
}

/* Status accents via left border */
.table tr--overdue td:first-child {
  box-shadow: inset 2px 0 0 var(--color-danger-accent);
}
```

**Column headers**:
- Sortable columns show chevron on hover, filled chevron when active sort
- Sort direction toggles on click

**Bulk selection**:
- First column checkbox when bulk actions enabled
- "Select all" checkbox in header
- Bulk action bar appears at top of table when any row selected

**Empty state**: If no rows, show empty-state component (section 8.4).

**Pagination**: Below table, shows "Showing 1-20 of 184" + page nav.

### 5.3 List view

**Purpose**: Alternative to table on mobile, or for simple item listings.

**Spec**: Each row is a card with:
- Left: icon or avatar (optional)
- Middle: primary label (weight 500) + secondary label (text-secondary, smaller)
- Right: action or meta info
- 16px padding, 0.5px bottom border (except last)

### 5.4 Navigation

See [Section 7 — Page shell](#7-page-shell) for sidebar and top-bar specs.

### 5.5 Breadcrumbs

**Purpose**: Show hierarchical location.

**Spec**:
- Horizontal list of links
- Separator: `/` or `>` (we use `>`), text-tertiary color, 8px margin on each side
- Current page: text-primary, not linked
- Ancestors: text-secondary, linked (underline on hover)

Example: `Sell > Invoices > INV-2026-0342`

### 5.6 Tabs

**Purpose**: Switch between peer views of the same context.

**Variants**:
- Underlined (default) — for main content switching
- Pill (rounded) — for secondary filters

**Underlined tabs spec**:
```css
.tabs {
  display: flex;
  gap: var(--space-2);
  border-bottom: var(--border-width-hairline) solid var(--color-border-subtle);
}

.tab {
  padding: var(--space-3) var(--space-4);
  font-size: var(--text-body);
  font-weight: var(--weight-regular);
  color: var(--color-text-secondary);
  border-bottom: var(--border-width-emphasis) solid transparent;
  cursor: pointer;
  transition: var(--transition-fast);
  background: none;
  border-top: none;
  border-left: none;
  border-right: none;
}

.tab:hover {
  color: var(--color-text-primary);
}

.tab--active {
  color: var(--color-text-primary);
  font-weight: var(--weight-medium);
  border-bottom-color: var(--color-charcoal);
}
```

**Count indicators**: Parenthetical counts after tab label, text-secondary color: "All (184)".

### 5.7 Banners

**Purpose**: Page-level notifications / announcements.

**Variants**:
- Info (blue-gray)
- Success (mint)
- Warning (saffron)
- Danger (brick)

**Spec**:
- Full-width container
- Icon on left (20px)
- Message text centered-left
- Optional action button on right
- Optional dismiss × on far right
- 12px vertical padding, 16px horizontal
- `--radius-lg`
- Background: semantic `--color-*-bg`
- Text: semantic `--color-*`
- Left border: 3px solid semantic accent color (optional, for emphasis)

### 5.8 Toasts

**Purpose**: Transient feedback (save success, error, info).

**Spec**:
- Bottom-right of viewport (bottom-center on mobile)
- Max width: 400px
- Background: `--color-charcoal`
- Text: `--color-off-white`
- Padding: 12px 16px
- `--radius-md`
- Slide-in from bottom animation (200ms)
- Auto-dismiss after 4 seconds (8 seconds for errors)
- Dismiss × on right
- Icon on left indicates type (check for success, alert-circle for error)

**Accessibility**: `role="status"` for success/info, `role="alert"` for errors. `aria-live="polite"`.

### 5.9 Modals

**Purpose**: Focus attention on a single task, blocking interaction with the underlying page.

**Spec**:
- Overlay: rgba(26, 26, 26, 0.4) full-viewport
- Modal container: centered, max-width by size variant
- Background: `--color-bg-elevated`
- `--radius-lg`
- `--shadow-modal`
- Close × in top-right (24px icon button)

**Sizes**:
- Small: 400px max-width (confirmations)
- Default: 560px max-width (simple forms)
- Medium: 720px max-width (standard forms, record payment)
- Large: 960px max-width (data-heavy like 3-way matching)
- Full: full viewport minus 32px margin (file preview)

**Structure**:
- Header: title (H2 22px) + optional subtitle + close ×
- Body: main content, scrollable if needed
- Footer: right-aligned buttons (Cancel outline + Primary filled)

**Accessibility**:
- `role="dialog"`, `aria-modal="true"`, `aria-labelledby` points to title
- Focus trap: Tab stays within modal
- Escape closes modal (unless destructive confirmation)
- Focus returns to trigger on close

### 5.10 Drawers (slide-outs)

**Purpose**: Side panel for secondary content without leaving the page (filters, details, comments).

**Spec**:
- Slides in from right
- Width: 400px small, 560px default, 720px wide
- Background: `--color-bg-elevated`
- Left border: 0.5px
- No overlay by default (allows continued interaction with main page)
- Close × in top-right

### 5.11 Stepper (for wizards)

**Purpose**: Show progress through a multi-step flow.

**Spec**:
- Horizontal row of steps
- Each step: circle (24px) with number inside + label below
- Current step: charcoal filled circle, white number
- Completed steps: mint filled circle, white check icon
- Upcoming steps: outlined circle, number in text-secondary
- Connector line between steps: 1px solid, mint if both adjacent are completed, else border-subtle

### 5.12 Empty state

**Purpose**: Communicate "nothing here yet" with a clear next action.

**Spec**:
- Centered content block
- Optional illustration at top (~160px wide, line-based)
- Heading: H3 (18px, 500)
- Description: body, max 2 lines, text-secondary
- Primary CTA button below
- Optional secondary action (text link)

### 5.13 Confirmation dialog (destructive)

**Purpose**: Prevent accidental destructive actions.

**Spec**: Modal (small size) with:
- Title: "Delete customer?" (H2 22px)
- Body: consequences explained in plain language
- **For serious actions**: Typed confirmation required ("Type DELETE to confirm")
- Buttons: Cancel (outline, left) + Destructive action (danger color, right, disabled until confirmation typed)

### 5.14 Popover

**Purpose**: Contextual panel anchored to a trigger.

**Difference from modal**: Popover doesn't block, doesn't center — anchored to trigger. Use for date pickers, dropdowns, quick-edit menus.

**Spec**:
- Background: `--color-bg-elevated`
- Border: 0.5px
- `--shadow-dropdown`
- `--radius-md`
- Padding: varies by content
- Arrow indicator pointing at trigger

### 5.15 Segmented control

**Purpose**: Switch between 2-5 exclusive options, shown inline.

**Spec**:
- Container: 1px border, `--radius-md`, background `--color-bg-secondary`
- Options: equal width, padding 8px 16px
- Active option: background `--color-bg-elevated`, `--shadow-sm` (subtle), text-primary
- Inactive options: text-secondary

Used in: POS tender method selector, report period switcher.

### 5.16 File upload

**Purpose**: Accept file input.

**Variants**:
- Drop zone (for drag-and-drop)
- Button-triggered file picker

**Drop zone spec**:
- Dashed border, 2px
- `--color-border-default`
- `--radius-lg`
- 32px padding
- Centered content: upload icon + "Drag and drop files here, or click to browse" + file types/size hint

**Drop state (when dragging file over)**:
- Border becomes solid mint
- Background becomes mint-surface

### 5.17 Form groups

**Purpose**: Organize related inputs with consistent spacing.

**Spec**:
- Form section: margin-bottom 24px
- Section header: H3 (18px, 500), margin-bottom 12px
- Field row: margin-bottom 16px
- Two-column field row: CSS grid `grid-template-columns: 1fr 1fr; gap: 16px`
- Help text below input: 4px top margin, 13px, text-secondary

### 5.18 Money display

**Purpose**: Consistent money formatting.

**Spec**:
```html
<span class="money">
  <span class="money__currency">LKR</span>
  <span class="money__amount">1,245,670.00</span>
</span>
```

```css
.money {
  font-feature-settings: 'tnum';
  white-space: nowrap;
}
.money__currency {
  font-weight: var(--weight-regular);
  color: var(--color-text-secondary);
  margin-right: 4px;
}
.money__amount {
  font-weight: var(--weight-medium);
  color: var(--color-text-primary);
}

/* Large variant for key figures */
.money--large .money__amount {
  font-size: var(--text-h2);
}

/* Negative amounts */
.money--negative .money__amount {
  color: var(--color-danger);
}
.money--negative .money__amount::before {
  content: '-';
}
```

### 5.19 Search bar

**Purpose**: Top-level content search.

**Spec**:
- Input with search icon on left (padding-left 36px)
- Clear × button on right when text entered
- Dropdown results panel below when typing
- Results grouped by entity type (customers, invoices, items)
- Keyboard navigation: up/down arrows, enter to select

---

## 6. Layout patterns

Repeatable layout structures used across the product.

### 6.1 Dashboard layout

Common dashboard pattern (used in Part 1 overview, Part 2 daily dashboard, Part 4 payroll dashboard):

```
┌───────────────────────────────────────────────────┐
│ Top bar (search, notifications, user menu)        │
├────────┬──────────────────────────────────────────┤
│Sidebar │ Page header (title, date range, CTA)    │
│        ├──────────────────────────────────────────┤
│        │ 4 metric cards in a row                  │
│        ├──────────────────────────────────────────┤
│        │ ┌──────────────┬──────────────────────┐  │
│        │ │ Main content │ Right context panel  │  │
│        │ │ (60%)        │ (40%)                │  │
│        │ │              │                      │  │
│        │ └──────────────┴──────────────────────┘  │
└────────┴──────────────────────────────────────────┘
```

### 6.2 List view layout

Used for invoices, customers, suppliers, items, etc.

```
┌───────────────────────────────────────────────────┐
│ Top bar                                           │
├────────┬──────────────────────────────────────────┤
│Sidebar │ Breadcrumb · Page title · Primary CTA    │
│        ├──────────────────────────────────────────┤
│        │ Status tabs (All, Draft, Posted...)      │
│        ├──────────────────────────────────────────┤
│        │ Filter row (date, filters, sort)         │
│        ├──────────────────────────────────────────┤
│        │ Summary bar (counts, totals)             │
│        ├──────────────────────────────────────────┤
│        │ Data table                                │
│        ├──────────────────────────────────────────┤
│        │ Pagination                                │
└────────┴──────────────────────────────────────────┘
```

### 6.3 Detail view layout

Used for invoice detail, customer detail, employee profile, etc.

```
┌───────────────────────────────────────────────────┐
│ Top bar                                           │
├────────┬──────────────────────────────────────────┤
│Sidebar │ Breadcrumb · Entity name · Actions       │
│        ├──────────────────────────────────────────┤
│        │ Hero card (key info, status, numbers)    │
│        ├──────────────────────────────────────────┤
│        │ Tabs (Overview, Activity, Notes, Files)  │
│        ├──────────────────────────────────────────┤
│        │ ┌──────────────┬──────────────────────┐  │
│        │ │ Tab content  │ Side info panel      │  │
│        │ └──────────────┴──────────────────────┘  │
└────────┴──────────────────────────────────────────┘
```

### 6.4 Form layout (single-page)

Used for create/edit invoice, bill, customer, etc.

```
┌───────────────────────────────────────────────────┐
│ Top bar                                           │
├────────┬──────────────────────────────────────────┤
│Sidebar │ Breadcrumb · Title · Save as draft | CTA │
│        ├──────────────────────────────────────────┤
│        │ ┌──────────────┬──────────────────────┐  │
│        │ │ Form content │ Context panel        │  │
│        │ │ (60%)        │ (preview, help,      │  │
│        │ │              │  related info) (40%) │  │
│        │ │ [Section]    │                      │  │
│        │ │ [Section]    │                      │  │
│        │ │ [Section]    │                      │  │
│        │ └──────────────┴──────────────────────┘  │
│        ├──────────────────────────────────────────┤
│        │ Sticky bottom: Cancel | Save as draft |  │
│        │                Preview | Submit          │
└────────┴──────────────────────────────────────────┘
```

### 6.5 Wizard layout (multi-step)

Used for setup wizard, payroll run, period close, etc.

```
┌───────────────────────────────────────────────────┐
│ Top bar (minimal, with "Skip" option)             │
├───────────────────────────────────────────────────┤
│ Stepper: (1)──(2)──(3)──(4)──(5)                  │
├───────────────────────────────────────────────────┤
│                                                   │
│     Step title (centered, H1)                    │
│     Step description (centered, body)            │
│                                                   │
│     ┌──────────────────────────────────────┐    │
│     │ Form fields                          │    │
│     └──────────────────────────────────────┘    │
│                                                   │
├───────────────────────────────────────────────────┤
│ [Back]                            [Continue →]    │
└───────────────────────────────────────────────────┘
```

### 6.6 Comparison layout

Used for pricing page, plan comparison.

```
┌───────────────────────────────────────────────────┐
│ Page header (centered)                            │
├───────────────────────────────────────────────────┤
│ ┌────────┬────────┬────────┬────────┐             │
│ │Starter │Growth  │Scale   │Enter-  │             │
│ │        │(popu-  │        │prise   │             │
│ │        │ lar)   │        │        │             │
│ │Price   │Price   │Price   │Custom  │             │
│ │CTA     │CTA     │CTA     │Contact │             │
│ └────────┴────────┴────────┴────────┘             │
│                                                   │
│ Feature comparison table                          │
└───────────────────────────────────────────────────┘
```

---

## 7. Page shell

The outer container every authenticated screen lives in.

### 7.1 Top bar

**Dimensions**: 56px tall, full viewport width.

**Layout** (left to right):
- Search bar (wide, 400-600px, centered-ish)
- On the right side:
  - "New" dropdown button (mint accent)
  - Notifications bell icon (with red dot for unread)
  - Help icon
  - User menu (avatar + chevron)

**Spec**:
- Background: `--color-bg-elevated`
- Bottom border: 0.5px `--color-border-subtle`
- Sticky (stays on top as page scrolls)

### 7.2 Sidebar

**Dimensions**:
- Desktop: 240px wide
- Tablet: 64px wide (icon-only rail)
- Mobile: hidden by default, slides in as overlay drawer

**Content** (vertical):
1. PettahPro logo (top, 16px padding)
2. Business switcher (if multi-business): business name + chevron
3. Primary nav section (scrollable if long)
4. Footer: Help, Settings, User menu

**Nav item spec**:
```css
.nav-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  color: var(--color-text-primary);
  font-size: var(--text-body);
  cursor: pointer;
  transition: var(--transition-fast);
  margin: 2px 8px;
}

.nav-item:hover {
  background: rgba(127, 184, 154, 0.2);
}

.nav-item--active {
  background: var(--color-mint);
  color: var(--color-text-on-mint);
  font-weight: var(--weight-medium);
}

.nav-item__icon { width: 18px; height: 18px; flex-shrink: 0; }
.nav-item__label { flex: 1; }
.nav-item__count {
  font-size: var(--text-caption);
  color: var(--color-text-tertiary);
}
```

**Nav sections** (from Tenant Admin UX spec):
1. Dashboard
2. Sell (sub: Invoices, Quotations, Sales Orders, Customers, POS)
3. Buy (sub: Bills, Purchase Orders, GRNs, Suppliers)
4. Inventory (sub: Items, Stock, Warehouses)
5. Accounting (sub: Journal, Chart of Accounts, Reports, Tax Returns)
6. Payroll (sub: Employees, Runs, Leave, Loans)
7. People
8. Settings

**Sidebar background**: `--color-bg-secondary` (mint-surface) to subtly distinguish from main content.

### 7.3 Main content area

**Dimensions**:
- Padding: 32px on desktop, 24px tablet, 16px mobile
- Max width: 1440px (content is constrained for readability)
- Background: `--color-bg-primary` (off-white)

### 7.4 Right context panel (optional)

- Width: 320px fixed at desktop, 280px tablet, hidden mobile
- Collapsible via toggle
- Purpose: contextual info, related data, preview

---

## 8. States and feedback

### 8.1 Loading states

| Context | Pattern |
|---|---|
| Page load (full) | Skeleton layout matching final shape |
| Data in a table | Skeleton rows (5 rows) |
| Card content | Skeleton blocks |
| Button action | Spinner replaces button text, button stays sized |
| Submit button | Spinner + text "Saving..." |
| Inline save | "Saved" text appears briefly in mint after save |
| Background sync | Small spinner icon in corner + text "Syncing..." |

### 8.2 Error states

| Context | Pattern |
|---|---|
| Form field validation | Error text below field, red border on input, alert icon |
| Form submission error | Banner at top of form (danger variant) with specifics |
| Page-level error (500) | Full-page empty state with refresh action |
| Network error | Toast: "Couldn't save — check connection and retry" |
| Permission denied | Banner: "You don't have permission. Ask [owner name]." |
| Validation with field highlight | Field-level errors + summary banner with "Fix 3 errors" |

### 8.3 Success states

| Context | Pattern |
|---|---|
| Save success | Toast: "Changes saved" (auto-dismiss 3s) |
| Major action complete | Banner on next screen: "Invoice INV-2026-0342 sent" |
| Completion milestone | Celebration moment (mint background, larger typography, optional illustration) — rare, first-invoice only |

### 8.4 Empty states

Every list has an empty state.

**Structure**:
- Centered content, ~400px width
- Optional illustration (line art, charcoal + mint)
- Heading (H3): states what's missing
- Description: 1-2 lines of context
- CTA: the action to resolve emptiness

Examples:
- "No invoices yet" + "Create your first invoice to start tracking revenue" + [Create invoice]
- "No overdue invoices" + "Your customers are paying on time" (celebratory, no CTA needed)
- "No search results" + "Try different keywords or clear filters" + [Clear filters]

### 8.5 Offline / network states

**Offline indicator**: Small banner at top of viewport when offline detected:
"You're offline. Changes will sync when you reconnect." (info variant)

**POS offline mode**: Dedicated handling — POS continues to work, queues transactions locally, shows persistent "Offline · X sales queued" indicator.

---

## 9. Motion and transitions

### 9.1 Philosophy

Motion is functional, not decorative. Every animation must have a reason: feedback, guidance, or continuity. No motion for motion's sake.

### 9.2 Standard durations

| Duration | Use |
|---|---|
| 75ms | Micro-interactions (button press) |
| 150ms | Hover states, small reveals |
| 200ms | Modal open/close, drawer slide |
| 300ms | Page transitions, complex reveals |
| 500ms | Celebration moments (first invoice confetti) |

### 9.3 Standard easing

- Default: `ease-out` (most animations — start fast, decelerate)
- Entrances: `cubic-bezier(0.0, 0.0, 0.2, 1)` — material "deceleration"
- Exits: `cubic-bezier(0.4, 0.0, 1, 1)` — material "acceleration"
- Emphasis: `cubic-bezier(0.4, 0.0, 0.2, 1)` — material "standard"

### 9.4 Common animations

| Animation | Spec |
|---|---|
| Modal open | Overlay fade-in 150ms, modal scale 0.95→1 + fade 200ms |
| Modal close | Reverse of open, 150ms |
| Drawer slide-in | Transform translateX 100% → 0, 200ms ease-out |
| Toast enter | Slide up from bottom, 200ms ease-out |
| Toast exit | Fade out, 200ms |
| Skeleton pulse | Opacity 1 ↔ 0.5, 1500ms ease-in-out, infinite |
| Tooltip show | Opacity 0 → 1, 150ms, after 400ms delay |
| Dropdown open | Opacity 0 → 1 + translateY 4px → 0, 150ms |
| Row hover | Background-color transition, 150ms |

### 9.5 Reduced motion

Respect `prefers-reduced-motion: reduce` — disable all non-essential animations, keep only state changes instant.

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## 10. Accessibility foundations

Target: **WCAG 2.1 AA**.

### 10.1 Color and contrast

Already verified in brand kit section 5.6. All text/background pairs pass AA.

**Additional rules**:
- Color alone is never the only indicator of state (always pair with icon or text)
- Error states: red color + alert icon + descriptive text
- Success states: mint color + check icon + descriptive text
- Required fields: visible `*` marker + `aria-required`

### 10.2 Keyboard navigation

**Every interactive element is keyboard accessible**:
- Tab moves forward through focusable elements
- Shift+Tab moves backward
- Enter activates buttons and links
- Space toggles checkboxes, radios, toggles
- Arrow keys navigate within components (tabs, dropdowns, date pickers)
- Escape closes modals, popovers, drawers

**Focus indicators**: Always visible on keyboard focus. `box-shadow: var(--shadow-focus)` ring.

**Skip links**: "Skip to main content" appears on Tab from top of page.

**Keyboard shortcuts** (for power users):
- `/` focuses search
- `N` opens "New" menu
- `?` shows keyboard shortcut reference
- `Esc` closes current modal/drawer

### 10.3 Screen reader support

**Semantic HTML first**: Use `<button>`, `<nav>`, `<main>`, `<article>`, `<aside>` — not `<div onclick>`.

**ARIA where needed**:
- `aria-label` on icon-only buttons
- `aria-describedby` linking form fields to errors/help
- `aria-live="polite"` for status announcements
- `aria-live="assertive"` for errors
- `aria-expanded` on expandable elements
- `aria-current="page"` on active nav

**Headings hierarchy**: h1 → h2 → h3 with no skipping. One h1 per page.

**Lists use list semantics**: `<ul>`, `<ol>`, `<li>` — not styled divs.

### 10.4 Focus management

- Modal open → focus moves to modal close button or first input
- Modal close → focus returns to trigger
- Route change → focus moves to h1 or main content
- Form error → focus moves to first invalid field

### 10.5 Touch targets

Mobile: **minimum 44×44px**. Use padding to achieve if element looks smaller.

Buttons, links, toggles, checkboxes all meet this.

### 10.6 Text scaling

UI must remain usable when browser text zoom is 200%. Test:
- No horizontal scrolling at 200% on 1280×720
- No cut-off text or overlapping elements
- Responsive breakpoints still trigger correctly

### 10.7 Forms accessibility

- Every `<input>` has an associated `<label>`
- Labels explicit (`for`/`id`), not implicit wrapping
- Error messages use `aria-describedby` linking input to error
- Fieldsets/legends for grouped inputs (e.g., radio groups)
- Required fields marked with `*` + `aria-required="true"`

### 10.8 Language attributes

`<html lang="en">` at document root. Set `lang="si"` or `lang="ta"` on elements containing non-English content to help screen readers pronounce correctly.

### 10.9 Reduced motion

Covered in section 9.5 — respect `prefers-reduced-motion`.

### 10.10 Testing

- Automated: axe DevTools, Lighthouse, pa11y in CI
- Manual: keyboard-only navigation for every new feature
- Screen reader: VoiceOver (Mac), NVDA (Windows) tested for key flows

---

## 11. Dark mode (Phase 2)

Dark mode is on the roadmap but not in v1. Design tokens are structured to support dark mode when implemented.

### 11.1 Planned token overrides

```css
@media (prefers-color-scheme: dark) {
  :root {
    --color-bg-primary: #0F0F0F;
    --color-bg-secondary: #1A1A1A;
    --color-bg-elevated: #1F1F1F;
    --color-bg-recessed: #141414;

    --color-text-primary: #FAFAF9;
    --color-text-secondary: #B4B2A9;
    --color-text-tertiary: #888780;

    --color-border-subtle: #2C2C2A;
    --color-border-default: #3D3D3A;
    --color-border-emphasis: #5F5E5A;

    --color-charcoal: #FAFAF9;  /* inverted for buttons */
    --color-mint: #7FB89A;       /* mint works in both modes */

    /* Semantic colors shift to more saturated variants for dark */
  }
}
```

### 11.2 Phase 2 checklist

- Full token override (colors only, spacing/typography unchanged)
- Test every component in dark mode
- Adjust chart colors for dark backgrounds
- Ensure brand assets (logos, illustrations) have dark-mode variants
- User toggle in settings (auto / light / dark)

---

## 12. System maintenance

### 12.1 Versioning

- `ui-system.md` versioned in Git
- Semantic versioning: major.minor.patch
- Major: breaking component API changes
- Minor: new components or non-breaking enhancements
- Patch: bug fixes, visual tweaks

### 12.2 Contribution process

1. Proposal: write up the proposed addition/change with rationale
2. Review: design lead + engineering lead sign off
3. Design: Figma mockups for new components
4. Implementation: component + Storybook story + unit tests
5. Documentation: add to this doc + usage examples
6. Release: bump version, release notes

### 12.3 Component audit

Quarterly review:
- Any components rarely used? (candidates for deprecation)
- Any components overloaded? (candidates for splitting)
- Any unofficial variants creeping in? (consolidate)
- Any accessibility regressions?
- Any performance issues (bundle size, runtime)?

### 12.4 Design-engineering sync

- Weekly sync between design and engineering leads
- Monthly full-team design system review
- Quarterly external audit (accessibility + visual)

---

## Next document

- **ux-patterns.md** — Information architecture, navigation taxonomy, interaction patterns, content/voice/microcopy library, PettahPro-specific UX decisions, screen-by-journey specifications

---

*Document version: 1.0 · UI System · Scope: Sri Lanka only · PettahPro design system*
