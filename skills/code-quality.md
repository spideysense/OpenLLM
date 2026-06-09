# Skill: Code Quality

Best practices for writing reliable, maintainable code.

## Architecture Principles
- **Single Responsibility**: each function/module does one thing
- **DRY**: extract repeated patterns into reusable functions
- **Fail fast**: validate inputs at boundaries, throw early
- **Defensive coding**: handle null, undefined, empty arrays, missing keys
- **Immutability**: prefer const, spread operator, .map/.filter over mutation

## Error Handling
```javascript
// BAD — swallowing errors
try { doThing(); } catch {}

// GOOD — handle or propagate with context
try {
  const result = await doThing();
  return result;
} catch (error) {
  console.error('[ModuleName] doThing failed:', error.message);
  throw new Error(`Failed to do thing: ${error.message}`);
}
```

## Naming Conventions
- Functions: verb + noun (`fetchUser`, `calculateTotal`, `parseResponse`)
- Booleans: `is`, `has`, `should`, `can` prefix (`isLoading`, `hasAccess`)
- Constants: UPPER_SNAKE_CASE for true constants
- Files: kebab-case (`user-profile.js`) or camelCase (`userProfile.js`)
- CSS classes: kebab-case (`.card-header`, `.btn-primary`)

## Code Review Checklist
Before committing any code, verify:
- [ ] No hardcoded secrets, keys, or passwords
- [ ] Error cases handled (null checks, try/catch, empty states)
- [ ] Functions are under 50 lines
- [ ] Variables have meaningful names
- [ ] No console.log left in production code (use console.error for errors)
- [ ] Responsive at 375px and 1280px
- [ ] Loading states exist for async operations
- [ ] User-facing strings are clear and helpful

## Testing Strategy
- **Unit tests**: pure functions, utilities, data transformations
- **Integration tests**: API endpoints, database queries
- **E2E tests**: critical user flows (signup, purchase, core action)
- Use descriptive test names: `it('should return 404 when user not found')`

## Performance
- Lazy load images: `<img loading="lazy">`
- Debounce search/filter inputs (300ms)
- Paginate large lists (50 items max per page)
- Use `requestAnimationFrame` for smooth animations
- Minimize DOM manipulation — batch updates

## Security
- Sanitize all user inputs (prevent XSS)
- Use parameterized database queries (prevent SQL injection)
- Validate on the server, never trust the client
- Set CORS headers appropriately
- Use HTTPS everywhere
- Never expose internal error details to users

## Git Workflow
- One feature per commit
- Commit messages: imperative mood (`Add user profile page`, not `Added`)
- Push after each logical change
- Never force-push to main
