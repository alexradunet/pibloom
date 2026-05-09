---
name: Digital Scoarță / Pixel Loom Minimalism
colors:
  surface: '#1a110f'
  surface-dim: '#1a110f'
  surface-bright: '#423733'
  surface-container-lowest: '#150c0a'
  surface-container-low: '#231916'
  surface-container: '#271d1a'
  surface-container-high: '#322824'
  surface-container-highest: '#3e322f'
  on-surface: '#f1dfd9'
  on-surface-variant: '#dcc1b8'
  inverse-surface: '#f1dfd9'
  inverse-on-surface: '#392e2b'
  outline: '#a48b84'
  outline-variant: '#56423c'
  surface-tint: '#ffb59d'
  primary: '#ffb59d'
  on-primary: '#5d1800'
  primary-container: '#b85736'
  on-primary-container: '#fffaf9'
  inverse-primary: '#9d4323'
  secondary: '#e9c267'
  on-secondary: '#3f2e00'
  secondary-container: '#755800'
  on-secondary-container: '#f8d074'
  tertiary: '#76d5dc'
  on-tertiary: '#00363a'
  tertiary-container: '#008087'
  on-tertiary-container: '#ecfeff'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#ffdbd0'
  primary-fixed-dim: '#ffb59d'
  on-primary-fixed: '#390b00'
  on-primary-fixed-variant: '#7e2c0e'
  secondary-fixed: '#ffdf9b'
  secondary-fixed-dim: '#e9c267'
  on-secondary-fixed: '#251a00'
  on-secondary-fixed-variant: '#5b4300'
  tertiary-fixed: '#93f2f9'
  tertiary-fixed-dim: '#76d5dc'
  on-tertiary-fixed: '#002022'
  on-tertiary-fixed-variant: '#004f54'
  background: '#1a110f'
  on-background: '#f1dfd9'
  surface-variant: '#3e322f'
typography:
  headline-lg:
    fontFamily: Newsreader
    fontSize: 40px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Newsreader
    fontSize: 28px
    fontWeight: '500'
    lineHeight: '1.3'
  body-lg:
    fontFamily: Work Sans
    fontSize: 18px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: Work Sans
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.5'
  label-md:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '500'
    lineHeight: '1.4'
    letterSpacing: 0.05em
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: '1.4'
    letterSpacing: 0.02em
  headline-lg-mobile:
    fontFamily: Newsreader
    fontSize: 32px
    fontWeight: '600'
    lineHeight: '1.2'
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  base: 4px
  xs: 8px
  sm: 16px
  md: 24px
  lg: 40px
  xl: 64px
  gutter: 24px
  margin: 32px
---

## Brand & Style

This design system is a "Digital Scoarță," blending the ancient tactile heritage of Romanian woven carpets with the precision of local-first computing. It evokes the feeling of a private, warm study—a digital hearth where sovereignty and craft are paramount. 

The aesthetic is a sophisticated fusion of **Minimalism** and **Tactile Pixel-Art**. It avoids the sterility of modern cloud interfaces in favor of grounded, earthy tones and rhythmic structural elements. The UI feels constructed rather than rendered, using subtle pixel-level motifs on dividers and borders to simulate the "stitch" of a loom. It is designed for operators who value privacy, long-form focus, and the beauty of visible craftsmanship in their digital tools.

## Colors

The palette is rooted in natural dyes: Madder Red, Ochre, and Moss. The foundation is "Charred Walnut," providing a deep, low-fatigue environment that emphasizes private sovereignty.

- **Foundations:** Use `Background` for the main application shell and `Surface` for nested navigation or sidebar elements. `Card` surfaces provide the highest elevation for interactive content.
- **Typography:** `Wool` is used for high-contrast readability, while `Muted Wool` handles secondary metadata and descriptions.
- **Accents & Actions:** `Madder Red` (Action) is reserved for primary intents and high-priority states. `Ochre` (Accent) is used for highlighting, active states, and focus indicators.
- **Semantics:** Moss (Success), Muted Indigo (System), and Ember (Danger) are desaturated to ensure they harmoniously integrate with the warm earthy base without appearing jarring.

## Typography

The typography strategy balances editorial elegance with technical precision. 

- **Headings:** Use **Newsreader** for all headers. It provides a literary, authoritative character that feels like a physical ledger or an ancestral loom's pattern book.
- **Interface:** **Work Sans** is used for its grounded, highly legible Swiss-inspired terminals, ensuring clarity in functional UI elements.
- **Data & Logs:** **JetBrains Mono** is utilized for metadata, tags, and system logs, reinforcing the local-first, operator-centric nature of this design system. It brings a technical "woven" rhythm to small-scale text.

## Layout & Spacing

This design system employs a **Fixed Grid** philosophy that mimics the rigid yet organic structure of a woven textile. 

- **Structure:** A 12-column grid for desktop with 24px gutters. Content is contained within a maximum width of 1280px to maintain focus. 
- **Rhythm:** All vertical spacing must be a multiple of the 4px base unit. 
- **Dividers:** Horizontal and vertical lines are not mere hairlines; they should use a "pixel-stitch" pattern—alternating 1px dashes that suggest a thread path.
- **Mobile:** Transition to a 4-column grid with 16px margins. Headlines scale down but maintain their editorial weight.

## Elevation & Depth

This system rejects shadows in favor of **Tonal Layers** and **Structural Outlines**. Depth is communicated through color value shifts and crisp, defined borders.

- **Stacking:** The closer an element is to the user, the warmer and lighter its background becomes (Charred Walnut → Deep Clay → Warmer Card Surface).
- **Borders:** Every surface and card uses a 1px solid border. The border color is typically a slightly lighter version of the background it sits on, or #b85736 (Madder Red) for active focus.
- **Pixel Motifs:** Use 4x4 pixel "notches" or corner accents on containers to denote interactive or important structural hubs. This replaces the need for ambient shadows.

## Shapes

The shape language is primarily rectangular and architectural. 

- **Corners:** Use a consistent 4px (0.25rem) radius for all cards, buttons, and inputs. This provides a "soft-brutalism" feel—stable but not sharp.
- **Intersections:** Elements should feel like they are "interlocked" rather than floating. Dividers should meet borders at 90-degree angles, creating a grid-like textile map.
- **Icons:** Use thick-stroke (2px) monolinear icons. Avoid rounded icon sets; prefer geometric or slightly pixelated representations.

## Components

- **Buttons:** Rectangular with 4px radius. Primary buttons use `Madder Red` background with `Wool` text. Secondary buttons use a `Warmer Card Surface` with a 1px `Ochre` border. 
- **Input Fields:** Use `Deep Clay` backgrounds with a bottom-only 1px border that extends into a "stitch" pattern on focus. Use **JetBrains Mono** for input text.
- **Cards:** Flat, `Warmer Card Surface` (#332016). Every card must have a 1px border. For interactive cards, add a 4-pixel "weaving" motif in the top-right corner.
- **Dividers:** Instead of solid lines, use a repeating 1px dash/gap pattern. This creates the "Pixel Loom" effect.
- **Status Chips:** Small, rectangular tags using `JetBrains Mono`. Backgrounds match the semantic color (Moss, Ember, Indigo) at 20% opacity with a solid 1px border of the same color.
- **Local-First Indicators:** A specific component (the "Hearth") should reside in the corner of the UI, using a pixelated flame or loom icon to show sync status and local database health.