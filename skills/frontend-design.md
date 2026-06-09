# Skill: Frontend Design

When building any UI, web app, or visual component, follow these principles.

## Design Tokens
Use CSS custom properties for theming. Define at :root level:
```css
:root {
  --bg: #0a0f1e;        /* deep navy background */
  --surface: #111827;    /* card/panel surface */
  --border: #1e293b;     /* subtle borders */
  --text: #f1f5f9;       /* primary text */
  --text-muted: #94a3b8; /* secondary text */
  --accent: #3b82f6;     /* primary action blue */
  --accent-hover: #2563eb;
  --success: #22c55e;
  --warning: #f59e0b;
  --danger: #ef4444;
  --radius: 12px;
  --radius-sm: 8px;
  --font: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
}
```

## Typography
- Use a type scale: 12, 14, 16, 20, 24, 32, 48px
- Body text: 15-16px, line-height 1.6
- Headings: font-weight 700, line-height 1.2
- Use font-weight to create hierarchy, not just size
- Import Google Fonts via CDN: `<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">`

## Layout
- Use CSS Grid for page layouts, Flexbox for component layouts
- Max content width: 1200px, centered with `margin: 0 auto`
- Consistent spacing scale: 4, 8, 12, 16, 24, 32, 48, 64px
- Card padding: 20-24px
- Section gaps: 32-48px
- Always add `box-sizing: border-box` globally

## Components
### Cards
```css
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px 24px;
  transition: border-color 0.15s, transform 0.15s;
}
.card:hover { border-color: var(--accent); transform: translateY(-1px); }
```

### Buttons
```css
.btn {
  padding: 10px 20px;
  border: none;
  border-radius: var(--radius-sm);
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.15s;
}
.btn-primary { background: var(--accent); color: #fff; }
.btn-primary:hover { background: var(--accent-hover); }
.btn-ghost { background: transparent; border: 1.5px solid var(--border); color: var(--text); }
```

### Inputs
```css
input, textarea, select {
  width: 100%;
  padding: 10px 14px;
  background: var(--bg);
  border: 1.5px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-size: 14px;
  transition: border-color 0.15s;
}
input:focus { outline: none; border-color: var(--accent); }
```

## Responsive Design
- Mobile-first: design for 375px, scale up
- Breakpoints: 480px (sm), 768px (md), 1024px (lg), 1280px (xl)
- Use `@media (min-width: 768px)` for tablet+
- Stack columns on mobile, side-by-side on desktop
- Touch targets minimum 44x44px on mobile

## Animation
- Use subtle transitions: `transition: all 0.15s ease`
- Hover effects: translateY(-1px), border-color change, subtle shadow
- Loading states: pulse animation or skeleton screens
- Page transitions: fade-in with opacity + translateY

## Dark Mode
- Default to dark mode for developer/professional tools
- Use CSS variables so theme switching is trivial
- Ensure sufficient contrast (WCAG AA: 4.5:1 for text)

## Icons
- Use emoji for quick prototypes
- Use Lucide icons via CDN for polished UIs: `<script src="https://unpkg.com/lucide@latest"></script>`

## Rules
- Everything in ONE self-contained HTML file
- No external frameworks (no React, no Tailwind CDN) — just clean CSS
- Google Fonts and icon CDNs are OK
- Make it responsive by default
- Add hover states, focus states, and transitions
- Use CSS Grid for complex layouts
- Test at 375px, 768px, and 1280px widths mentally
