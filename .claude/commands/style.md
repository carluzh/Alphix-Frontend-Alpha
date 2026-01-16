# Alphix Frontend Style Guide

**YOU MUST follow these style guidelines when creating or modifying UI components.**

This guide consolidates all styling conventions, color systems, component patterns, and spacing standards used across the Alphix frontend application.

---

## 🎨 Color System

### Core Brand Variables (Lines 7-30 in globals.css)

**✅ SINGLE SOURCE OF TRUTH** - All app styling derives from these 14 variables:

```css
/* Brand Colors */
--brand-primary: #f45502;          /* Alphix Orange - used for CTAs, highlights, accents */

/* Backgrounds (darkest to lightest) */
--main-bg: #0f0f0f;                /* App background, darkest level */
--container-bg: #131313;           /* Swap containers, cards, main content blocks */
--container-secondary-bg: #161616; /* Elevated elements (charts, preview cards) */
--surface-bg: #181818;             /* Input fields, interactive surfaces */
--modal-bg: #161616;               /* Modal dialogs, overlays */
--selector-bg: #1b1b1b;            /* Dropdowns, token selectors */

/* Borders */
--border-primary: #323232;         /* Standard borders throughout app */
--border-secondary: #4a4a4a;       /* Lighter borders for elevated/secondary elements */

/* Buttons */
--button-primary-bg: #3d271b;      /* Primary CTA button background */
--button-primary-bg-hover: #312015;/* Primary button hover state */
--button-secondary-bg: #1f1f1f;    /* Secondary/cancel buttons */

/* Interactions */
--hover-bg: #282828;               /* General hover states */

/* Misc */
--radius: 0.5rem;                  /* Border radius for all components */
```

### Utility Classes (Lines 119-183 in globals.css)

**✅ USE THESE** - Semantic classes that reference core variables:

```css
/* Backgrounds */
.bg-main                  /* --main-bg (#0f0f0f) */
.bg-container             /* --container-bg (#131313) - most common */
.bg-container-secondary   /* --container-secondary-bg (#161616) - charts, previews */
.bg-surface               /* --surface-bg (#181818) - input fields */
.bg-modal                 /* --modal-bg (#161616) */
.bg-selector              /* --selector-bg (#1b1b1b) - dropdowns */
.bg-button                /* --button-secondary-bg (#1f1f1f) */
.bg-button-primary        /* --button-primary-bg (#3d271b) */

/* Borders */
.border-primary           /* --border-primary (#323232) - default borders */
.border-secondary         /* --border-secondary (#4a4a4a) - elevated elements */

/* Hover States */
.hover-button-primary:hover  /* --button-primary-bg-hover (#312015) */
```

### Tailwind + CSS Variable Pattern

For Tailwind integration, use `border-sidebar-border` which references `--sidebar-border` (equals `--border-primary`).

### shadcn/ui Integration

**Required variables for shadcn compatibility** (lines 33-98 in globals.css):
- `--background`, `--foreground`, `--card`, `--popover`, `--primary`, `--muted`, `--accent`, `--border`
- Most are mapped to our core variables (e.g., `--background: var(--main-bg)`)

---

## 🎨 Component Styling Patterns

### 1. Buttons

#### Primary Buttons (CTAs)
```tsx
// Pattern: bg-button-primary + brand primary border + brand primary text + hover state
<Button className="bg-button-primary border border-sidebar-primary text-sidebar-primary hover-button-primary">
  Confirm Swap
</Button>
```
**Used in**: Main action buttons (Swap, Add Liquidity, Deposit, Sign Permit, Confirm)

**Key classes**:
- `bg-button-primary` - Background color (#3d271b)
- `border-sidebar-primary` - Brand orange border (#f45502)
- `text-sidebar-primary` - Brand orange text (#f45502)
- `hover-button-primary` - Hover state (changes to #312015)

**Hover behavior**: Background instantly changes from `#3d271b` to `#312015` on hover (no transition/animation)

#### Secondary Buttons
```tsx
// Pattern: bg-button + standard border + pattern overlay
<button 
  className="border border-sidebar-border bg-button px-3 text-sm hover:brightness-110 hover:border-white/30"
  style={{ backgroundImage: 'url(/patterns/button-default.svg)', backgroundSize: 'cover' }}
>
  Cancel
</button>
```
**Pattern variations**:
- `/patterns/button-default.svg` - For square/small buttons
- `/patterns/button-wide.svg` - For rectangular/wide buttons

**Hover behavior**:
- `brightness-110` - Slightly brighter
- `border-white/30` - Border becomes semi-transparent white

#### Ghost Tab Buttons (View Toggles)
```tsx
// Pattern: Clean, minimal toggle buttons for switching views
// Uses shadcn/ui Button with ghost variant
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

<Button
  variant="ghost"
  size="sm"
  className={cn(
    "h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50",
    isActive && "bg-muted/50 text-foreground"
  )}
>
  Tab Label
</Button>

// OR use utility classes (for native buttons)
<button className={cn("ghost-tab", isActive && "ghost-tab-active")}>
  Tab Label
</button>
```
**Used in**: Chart tabs (Dynamic Fee/Volume/TVL), modal action buttons (Add/Remove/Collect), view toggles

**Key classes (from globals.css)**:
- `.ghost-tab` - Base styling: `h-7 px-2.5 text-xs rounded-md text-muted-foreground bg-transparent`
- `.ghost-tab-active` - Active state: `bg-muted/50 text-foreground`
- Hover: `hover:text-foreground hover:bg-muted/50`

**Styling characteristics**:
- Minimal, unobtrusive appearance
- Text-only by default (muted grey)
- Subtle background on hover/active
- Compact size (h-7, text-xs)
- No borders

### 2. Containers & Cards

#### Standard Container (Swap, Token Selection)
```tsx
<div className="rounded-lg border border-sidebar-border bg-container">
  {/* Content */}
</div>
```
**Background**: `#131313` (dark grey)
**Border**: `#323232` (medium grey)
**Used in**: Main swap card, position cards, liquidity forms

#### Elevated/Secondary Container (Charts, Previews)
```tsx
<div className="rounded-lg border border-sidebar-border bg-container-secondary">
  {/* Chart content */}
</div>
```
**Background**: `#161616` (slightly lighter than standard)
**Border**: `#323232` (same as standard)
**Used in**: Dynamic fee chart preview, elevated UI elements

**Why the difference?** Creates visual hierarchy - charts and preview cards appear slightly "elevated" above main content.

#### Surface/Input Fields
```tsx
<div className="rounded-lg border border-transparent hover:border-sidebar-border bg-surface">
  <input className="bg-transparent" />
</div>
```
**Background**: `#181818` (noticeably lighter)
**Border**: Transparent by default, shows on hover/focus
**Used in**: Token input fields, amount inputs, interactive surfaces

### 3. Modals & Dialogs

```tsx
<Dialog>
  <DialogContent className="bg-modal border border-sidebar-border">
    {/* Content */}
  </DialogContent>
</Dialog>
```
**Background**: `#161616`
**Border**: `#323232`

### 4. Dropdowns & Selectors

```tsx
// Token selector, range selector buttons
<button className="bg-selector border border-sidebar-border hover:bg-accent">
  Select Token
</button>
```
**Background**: `#1b1b1b` (lightest standard bg)
**Used in**: Token selector modal, dropdown menus, combo boxes

---

## 🎭 Special UI Elements

### Dynamic Fee Chart Preview

**Unique styling** - Uses elevated background to stand out:
```tsx
<div className="rounded-lg border border-sidebar-border bg-container-secondary">
  {/* Chart visualization */}
</div>
```
**Why different?** Charts need visual separation from surrounding content. The lighter background (#161616) creates depth.

### Striped Outlines (Category Filters)

```tsx
<div className="rounded-lg border border-dashed border-sidebar-border/60 bg-muted/10">
  {/* Stats cards */}
</div>
```
**Pattern**: Dashed border with low opacity for subtle visual grouping
**Used in**: Liquidity page stat summary, filter categories

### Position Cards

```tsx
<div className="rounded-lg border border-sidebar-border bg-container hover:bg-muted/30 transition-colors">
  {/* Position details */}
</div>
```
**Hover**: Subtle background lightening with `bg-muted/30`
**Used in**: Portfolio positions, liquidity positions

### Beta Badge & Feature Tags

```tsx
<Badge className="bg-button-primary text-sidebar-primary border-sidebar-primary hover-button-primary">
  Beta
</Badge>
```
**Styling**: Uses primary button colors for emphasis
**Pattern overlay**: Often includes `/patterns/button-default.svg` background

---

## 🎨 Loading States & Skeletons

### Loading Skeletons

```tsx
// Pulsing placeholder
<div className="h-4 w-20 bg-muted/60 rounded animate-pulse" />

// Spinner with icon
<div className="animate-pulse">
  <Image src="/logos/alphix-icon-white.svg" className="opacity-60" />
</div>
```

**Key classes**:
- `bg-muted/60` - Semi-transparent grey for skeleton backgrounds
- `animate-pulse` - Built-in Tailwind pulsing animation
- Low opacity (40-60%) for subtle appearance

**Used in**: Table loading states, chart initialization, data fetching

---

## 🎨 Icons & Visual Elements

### Brand Colors in SVGs

```tsx
// Current price marker in position previews
<div className="w-0.5 bg-sidebar-primary" />  {/* Orange vertical line */}
<div className="w-2 h-2 rounded-full bg-sidebar-primary" />  {/* Orange dot */}
```
**Color**: `var(--sidebar-primary)` = `#f45502` (brand orange)

### Icon Overlap Background

```tsx
// For overlapping token icons (e.g., ETH/USDC pair)
<div className="rounded-full bg-main">
  <Image src={tokenIcon} />
</div>
```
**Background**: Uses `bg-main` (#0f0f0f) to create cutout effect

---

## 🎨 Sidebar Styling

### Sidebar Structure

**Layout**: Uses shadcn `Sidebar` component with custom theme
**Background**: `--sidebar-background: #131313` (equals `--container-bg`)
**Foreground**: `#ffffff` (white text)
**Border**: `--sidebar-border: #323232`

### Sidebar States

```tsx
// Active link
data-[active=true]:bg-sidebar-accent  // #282828 (hover-bg)
data-[active=true]:text-sidebar-accent-foreground  // white

// Hover state
hover:bg-sidebar-accent  // #282828
hover:text-sidebar-accent-foreground  // white
```

### Sidebar Components

**Connect Button**: Uses `.bg-button` (#1f1f1f) with pattern overlay
**Beta Badge**: Uses `.bg-button-primary` (#3d271b)
**Level Ring**: Custom colors `#303030` (track) and `#c7c7c7` (progress)

---

## 🎨 Custom Component Overrides

### AppKit Wallet Button

**Location**: `globals.css` lines 186-210

```css
appkit-button {
  all: unset;  /* Aggressive reset */
  /* Then apply sidebar-consistent styling */
  background-color: transparent;
  color: var(--sidebar-foreground);
  /* ... */
}

appkit-button:hover {
  background-color: var(--sidebar-accent);  /* #282828 */
  color: var(--sidebar-accent-foreground);
}
```

**Why custom?** Third-party wallet component needs to match sidebar theme.

### Range Slider (Liquidity)

**Location**: `globals.css` lines 237-283

```css
.slider {
  background: transparent;
  /* Hidden by default */
}

.slider:hover::-webkit-slider-thumb {
  opacity: 1;
  background: var(--button-secondary-bg);  /* #1f1f1f */
  border: 2px solid var(--border-primary);  /* #323232 */
}
```

**Behavior**: Thumb only appears on hover with subtle styling

---

## 🎨 Chart & Data Visualization

### Recharts Customization

**Tooltips** (globals.css lines 219-222):
```css
.recharts-tooltip-wrapper .recharts-default-tooltip {
  background-color: var(--container-bg) !important;  /* #131313 */
  border: 1px solid var(--border-primary) !important;  /* #323232 */
  color: #ffffff !important;
}
```

**Focus states**:
```css
.recharts-surface:focus {
  outline: none;
  border: none;
}
```

### Chart Colors

**Dynamic Fee Chart** (from globals.css):
```css
--chart-1: 0 0% 60%;  /* Light grey */
--chart-2: 0 0% 48%;  /* Medium grey */
--chart-3: 0 0% 40%;  /* Dark grey */
```

**Primary line**: Uses `var(--sidebar-primary)` (#f45502 - brand orange)

---

## 🎨 Toast Notifications (Sonner)

**Styling** (globals.css lines 230-235):
```css
[data-sonner-toaster] [data-sonner-toast] {
  background-color: var(--container-bg) !important;  /* #131313 */
  border: 1px solid var(--border-primary) !important;  /* #323232 */
  color: #ffffff !important;
}
```

**Usage**:
```tsx
import { toast } from "sonner"

toast.success("Success", { icon: <BadgeCheck className="h-4 w-4 text-green-500" /> })
toast.error("Error", { icon: <OctagonX className="h-4 w-4 text-red-500" /> })
```

---

## 🎨 Responsive Breakpoints

### Standard Tailwind Breakpoints

```css
sm:   /* 640px */
md:   /* 768px */
lg:   /* 1024px */
xl:   /* 1280px */
2xl:  /* 1536px */
```

### Custom Breakpoints

**Responsive Grid** (globals.css lines 285-292):
```css
@media (min-width: 1400px) {
  .responsive-grid {
    grid-template-columns: 1fr 1fr;  /* 2-column layout */
    gap: 1rem;
  }
}
```
**Used in**: Portfolio positions layout

**Swap Component Visibility**:
```tsx
// Custom 1010px breakpoint (inline)
className="min-[1010px]:block"
```

---

## 🎯 Typography

### Font Families

**Primary**: Inter (sans-serif) - Used throughout app
**Monospace**: Consolas - Used for technical elements (headers, badges)

### Font Weights

**Landing page**: Custom weights (300, 450, 550)
**App pages**: Tailwind classes (`font-medium`, `font-semibold`)

### Text Colors

```tsx
text-foreground          // Primary text (white/near-white)
text-muted-foreground    // Secondary text (grey)
text-sidebar-primary     // Brand orange (#f45502)
```

---

## ✅ Style Consolidation Status

### ✅ Fully Consolidated Pages (Use only lines 7-30)

- `/swap` - All swap views and token selection
- `/liquidity` - Pools table and filtering
- `/liquidity/[poolId]` - Pool details, all modals, forms, charts
- `/portfolio` - Portfolio overview and management
- `/login` - Authentication page

### 📋 Not Consolidated (Separate Brand System)

- `/` - Landing page (uses `#1e1d1b`, `#0a0907`)
- `/brand` - Brand page (uses same landing colors)
- Marketing components (RequestAccessButton, notifications)

**Reason**: Landing/marketing pages intentionally use different branding.

---

## 🚨 Important Patterns & Rules

### ❌ DO NOT USE

```tsx
// Hardcoded hex colors
className="bg-[#131313]"  // Use .bg-container instead
className="border-[#323232]"  // Use border-sidebar-border instead

// Inline CSS variable syntax (verbose)
className="bg-[var(--button-secondary-bg)]"  // Use .bg-button instead
```

### ✅ ALWAYS USE

```tsx
// Utility classes
className="bg-container border-sidebar-border"

// For unique cases not covered by utilities
style={{ backgroundColor: 'var(--hover-bg)' }}
```

### ⚠️ EXCEPTION: Pattern Overlays

```tsx
// Pattern backgrounds are inline styles (acceptable)
style={{ 
  backgroundImage: 'url(/patterns/button-default.svg)', 
  backgroundSize: 'cover', 
  backgroundPosition: 'center' 
}}
```

---

## 📂 Reference Files

**Core Variables**: `app/globals.css` (lines 7-30)
**Utility Classes**: `app/globals.css` (lines 119-183)
**Component Overrides**: `app/globals.css` (lines 186-283)
**shadcn Theme**: `app/globals.css` (lines 33-98)

**shadcn Components**: `components/ui/*.tsx` (56 total)
**Utilities**: `lib/utils.ts` (cn, formatTokenAmount, shortenAddress)

---

## 🎓 Quick Reference Card

**Need a...** | **Use...**
---|---
Main container | `bg-container border-sidebar-border`
Elevated card | `bg-container-secondary border-sidebar-border`
Input field | `bg-surface border-transparent hover:border-sidebar-border`
Primary button | `bg-button-primary border-sidebar-primary text-sidebar-primary hover-button-primary`
Secondary button | `bg-button border-sidebar-border` + pattern overlay
Ghost tab/toggle | `Button variant="ghost"` + `h-7 px-2.5 text-xs text-muted-foreground hover:bg-muted/50`
Modal background | `bg-modal border-sidebar-border`
Dropdown/selector | `bg-selector border-sidebar-border`
Loading skeleton | `bg-muted/60 animate-pulse`
Brand accent | `text-sidebar-primary` or `bg-sidebar-primary`

---

**Last Updated**: January 2025 (Post CSS Consolidation)
**Maintained By**: Manual updates as styles evolve
