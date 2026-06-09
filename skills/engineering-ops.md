# Skill: Engineering Operations

## CI/CD Pipeline
Standard GitHub Actions workflow:
```yaml
name: Deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm ci
      - run: npm test
      - run: npm run build
      # Deploy step varies by platform
```

## Deployment Platforms
- **Vercel**: `git push` auto-deploys. Add env vars in dashboard.
- **Cloudflare Pages**: similar to Vercel, great for static + edge functions
- **Railway/Render**: for persistent servers, databases, background jobs
- **GitHub Pages**: static only, free

## Monitoring Checklist
- [ ] Error tracking (Sentry, LogRocket)
- [ ] Uptime monitoring (Better Uptime, Checkly)
- [ ] Performance (Lighthouse CI, Web Vitals)
- [ ] Logs (structured JSON, searchable)
- [ ] Alerts (PagerDuty, Slack webhooks)

## Incident Response
1. **Detect**: automated alerts fire
2. **Triage**: severity (P0-critical, P1-high, P2-medium, P3-low)
3. **Communicate**: status page update, Slack announcement
4. **Fix**: deploy hotfix or rollback (`git revert HEAD && git push`)
5. **Postmortem**: what happened, root cause, action items

## Database Operations
- Always backup before migrations
- Use transactions for multi-step writes
- Add indexes before deploying queries that need them
- Monitor slow queries (>100ms)
- Connection pooling for serverless (use Neon/Supabase pooler)

## Security Checklist
- [ ] HTTPS everywhere
- [ ] Environment variables for secrets (never in code)
- [ ] Rate limiting on auth endpoints
- [ ] Input validation and sanitization
- [ ] CORS configured correctly
- [ ] Dependencies audited (`npm audit`)
- [ ] CSP headers set

## Release Process
1. Feature branch → PR → code review → merge to main
2. CI runs tests + builds
3. Preview deploy for visual QA
4. Merge triggers production deploy
5. Monitor error rates for 30 minutes post-deploy
6. Tag release: `git tag v1.2.3 && git push --tags`

## Infrastructure as Code
- Vercel: `vercel.json` for routes, headers, rewrites
- Cloudflare: `wrangler.toml` for workers config
- Docker: `Dockerfile` for containerized apps
- Terraform: for cloud infrastructure (AWS, GCP)
