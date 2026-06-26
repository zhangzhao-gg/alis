---
name: Nocturne
colors:
  surface: '#131315'
  surface-dim: '#131315'
  surface-bright: '#39393b'
  surface-container-lowest: '#0e0e10'
  surface-container-low: '#1c1b1d'
  surface-container: '#201f21'
  surface-container-high: '#2a2a2c'
  surface-container-highest: '#353437'
  on-surface: '#e5e1e4'
  on-surface-variant: '#cec4ca'
  inverse-surface: '#e5e1e4'
  inverse-on-surface: '#313032'
  outline: '#978e95'
  outline-variant: '#4c454a'
  surface-tint: '#d8bfd6'
  primary: '#d8bfd6'
  on-primary: '#3c2b3c'
  primary-container: '#5e4b5e'
  on-primary-container: '#d6bdd3'
  inverse-primary: '#6c586c'
  secondary: '#e9bbbb'
  on-secondary: '#462828'
  secondary-container: '#5f3e3e'
  on-secondary-container: '#d7aaaa'
  tertiary: '#dcc0c0'
  on-tertiary: '#3e2c2c'
  tertiary-container: '#614c4c'
  on-tertiary-container: '#dabebe'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#f5dbf2'
  primary-fixed-dim: '#d8bfd6'
  on-primary-fixed: '#251627'
  on-primary-fixed-variant: '#534153'
  secondary-fixed: '#ffdad9'
  secondary-fixed-dim: '#e9bbbb'
  on-secondary-fixed: '#2e1414'
  on-secondary-fixed-variant: '#5f3e3e'
  tertiary-fixed: '#f9dcdb'
  tertiary-fixed-dim: '#dcc0c0'
  on-tertiary-fixed: '#271718'
  on-tertiary-fixed-variant: '#564242'
  background: '#131315'
  on-background: '#e5e1e4'
  surface-variant: '#353437'
typography:
  display:
    fontFamily: Inter
    fontSize: 48px
    fontWeight: '300'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '400'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '400'
    lineHeight: 32px
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '300'
    lineHeight: 28px
    letterSpacing: 0.01em
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
    letterSpacing: 0.05em
  label-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 8px
  container-max: 1200px
  gutter: 32px
  margin-desktop: 64px
  margin-mobile: 24px
  sidebar-width: 280px
---

## Brand & Style
The design system is built around the concept of "Quiet Intimacy." It targets users seeking a calm, contemplative AI companion that feels more like a private journal or a late-night confidant than a utility tool. 

The aesthetic is **Dark Minimalism** with a **Cinematic** edge. It avoids the frantic energy of typical tech products, opting instead for a "late-night quiet room" atmosphere. The UI should feel soft and receding, allowing the conversation to take center stage. There are no harsh borders or aggressive transitions; everything should feel like it is emerging from or dissolving into the shadows.

## Colors
The palette is deeply nocturnal, utilizing low-light levels to reduce eye strain and evoke a sense of calm.

- **Backgrounds:** The primary canvas uses `#0A0A0C` (Deep Charcoal), with `#111418` (Blue-Black) reserved for panels and drawers to provide subtle depth without traditional shadows.
- **Accents:** Muted tones of Smoky Plum (`#5E4B5E`) and Wine Red (`#4A2C2C`) are used sparingly for focal points and interactive states.
- **Typography:** Warm off-white (`#E2E2E2`) provides high legibility against the dark background, while soft gray (`#8E8E93`) is used for metadata and secondary context.

## Typography
This design system utilizes **Inter** for its modern, clean, yet highly legible characteristics. To achieve an "editorial" feel, we emphasize generous line heights and light font weights.

- **Display & Headlines:** Use light weights (300/400) with slight negative letter spacing to create a sophisticated, high-end appearance.
- **The Chat Stream:** Text should appear like lyrics or poetry. Use `body-lg` for AI responses to prioritize readability and a feeling of "presence."
- **Labels:** Use `label-md` with tracking (letter-spacing) for a refined, architectural look on buttons and navigation tabs.

## Layout & Spacing
The layout follows a **Fixed Grid** approach for the central narrative stream, allowing for wide, empty margins that contribute to the "quiet" atmosphere.

- **The Narrative Stream:** A centered column (max-width 800px) where the conversation flows vertically without containers.
- **Drawer Panels:** Side panels (drawers) slide out from the right, mimicking the opening of a private notebook.
- **Vertical Tabs:** Located on the far left, these "bookmark-style" tabs are thin and minimal, using vertical text or icons to minimize visual clutter.
- **Empty Space:** Whitespace (or "Darkspace") is treated as a primary design element. Do not feel the need to fill the edges of the screen.

## Elevation & Depth
Depth is created through **Tonal Layers** and **Ambient Glows** rather than harsh shadows.

- **Surface Tiers:** The base layer is `#0A0A0C`. Interactive panels or drawers use `#111418`.
- **Soft Glow:** The central focal avatar (the AI's presence) utilizes a soft, pulsing radial gradient in Smoky Plum or Wine Red. This glow should be extremely diffuse (60px - 100px blur).
- **Glassmorphism:** Use very light backdrop blurs (10px - 20px) for the vertical tab bar and top navigation to suggest a layer of frosted glass over the dark void.

## Shapes
The shape language is primarily linear and architectural, with subtle rounding to maintain a "soft" feel.

- **Global Radius:** Use `0.25rem` (Soft) for most UI elements like input fields and panels.
- **The Avatar:** The only perfectly circular element in the UI, serving as the organic focal point.
- **Tabs:** Bookmark-style tabs should have a slight rounding only on the outer corners (the side facing the content).

## Components
- **The Chat Stream:** Absolutely no speech bubbles. Text is presented as a continuous vertical stream. AI text is `text_primary`, while User text is `text_secondary` and slightly indented.
- **Focal Avatar:** A circular element in the top-center or side-drawer that pulses with an ambient glow when the AI is "thinking" or "speaking."
- **Buttons:** Low-contrast. Use `background_surface` with a thin `1px` border of `smoky plum`. Text is always uppercase `label-md`.
- **Input Fields:** A single, clean line at the bottom of the screen. No heavy box. The placeholder text should be a soft, inviting prompt like "Tell me something..."
- **Vertical Tabs:** Thin strips on the edge of the screen. Active states are indicated by a subtle color shift to Wine Red and a small dot, rather than a large highlight block.
- **Notebook Drawers:** Large, full-height panels that slide in. Use `background_surface` with internal padding of `40px` to mimic the page of a book.