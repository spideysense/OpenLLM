# Skill: Full-Stack Web App

When building a complete web application, follow this architecture.

## Single-File Apps (Artifacts)
For apps that fit in one file — dashboards, tools, games, calculators:
- ONE self-contained HTML file with `<style>` and `<script>` tags
- Use vanilla JS — no React, no frameworks
- Use Google Fonts CDN and icon CDNs as needed
- Use CSS custom properties for theming
- Use localStorage for persistence (warn user data is browser-only)
- Structure: semantic HTML → complete CSS → all JS at bottom

## Multi-File Apps (Git Repos)
For complex apps that need a repo — SaaS, multi-page apps:

### Stack
- **Framework**: Next.js 14+ (App Router) or plain HTML/JS
- **Styling**: Tailwind CSS or CSS Modules
- **Database**: Vercel KV (Redis), Vercel Postgres (Neon), or Supabase
- **Auth**: Clerk, NextAuth, or Supabase Auth
- **Payments**: Stripe (embedded Payment Element)
- **AI**: Claude API, OpenAI API, or local model
- **Deploy**: Vercel (auto-deploy from Git)

### File Structure
```
app/
  layout.tsx        — root layout with providers
  page.tsx          — landing page
  dashboard/
    page.tsx        — main app page
  api/
    [route]/
      route.ts      — API endpoints
components/
  ui/               — reusable UI components
lib/
  db.ts             — database connection
  auth.ts           — auth helpers
  utils.ts          — shared utilities
```

### API Design
- Use Next.js Route Handlers (app/api/[route]/route.ts)
- Return JSON with consistent shape: `{ data, error }`
- Validate inputs server-side
- Use try/catch with meaningful error messages
- Set appropriate HTTP status codes

### Database
- Use parameterized queries (never string interpolation)
- Add indexes for frequently queried columns
- Use migrations for schema changes
- Keep queries simple — join in application code if needed

### Environment Variables
- Store secrets in `.env.local` (never commit)
- Use `process.env.VAR_NAME` server-side only
- Prefix with `NEXT_PUBLIC_` for client-side access
- Document required env vars in README

## Deployment via run_command
When deploying to Vercel from a Git repo:
```
run_command({ command: "cd /tmp/project && git add -A && git commit -m 'deploy' && git push origin main" })
```
Vercel auto-deploys from the main branch.

## Code Quality
- Use TypeScript for type safety
- Add error boundaries around async operations
- Implement loading states (skeleton screens, spinners)
- Add empty states ("No items yet — create your first one")
- Handle edge cases: empty data, long strings, slow networks
- Test at mobile and desktop widths
