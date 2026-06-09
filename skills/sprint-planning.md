# Skill: Sprint Planning & Execution

## Sprint Planning
When asked to plan a sprint or break down work:

### Sprint Document Format
```markdown
# SPRINT-[XXXX] — [Theme]
**Duration**: [start] → [end] (2 weeks)
**Goal**: [one sentence describing what success looks like]

## Tickets

### [S] TICKET-001: [Title]
- **Type**: feature | bug | chore | spike
- **Priority**: P0 (critical) | P1 (high) | P2 (medium) | P3 (low)
- **Estimate**: XS (1h) | S (2-4h) | M (1d) | L (2-3d) | XL (1w)
- **Description**: what needs to be done
- **Acceptance criteria**:
  - [ ] Criterion 1
  - [ ] Criterion 2
- **Dependencies**: TICKET-XXX (if any)

## Risks
- [Risk 1]: [Mitigation]

## Definition of Done
- [ ] Code reviewed
- [ ] Tests passing
- [ ] Deployed to staging
- [ ] Product sign-off
```

### Estimation
- Use t-shirt sizes, not hours (less precise = more honest)
- XS: trivial, <1 hour
- S: straightforward, 2-4 hours
- M: moderate complexity, 1 day
- L: significant work, 2-3 days
- XL: needs breakdown into smaller tickets

### Capacity Planning
- 2-week sprint = 10 working days
- Subtract: meetings (1-2d), reviews (0.5d), unexpected (1d)
- Effective capacity: ~6-7 days per person
- Plan to 80% capacity (leave buffer)

## Sprint Execution
### Daily Standup (async)
Each person posts:
- ✅ Done yesterday
- 🎯 Doing today
- 🚧 Blockers

### Mid-Sprint Check
- Are we on track for the sprint goal?
- Any scope that should be cut?
- Any blockers unresolved for >24h?

### Sprint Review
- Demo completed work to stakeholders
- Collect feedback
- Update backlog based on feedback

### Sprint Retro
- ✅ What went well?
- ❌ What didn't go well?
- 💡 What should we try differently?
- Pick 1-2 action items for next sprint

## Backlog Grooming
- Prioritize by impact × urgency
- Top of backlog should be ready to start (has AC, designs, dependencies resolved)
- Bottom of backlog can be rough ideas
- Remove items >6 months old that haven't been prioritized
