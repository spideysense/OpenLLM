# Skill: UX Research & Design

## User Research
### Interview Guide
1. **Warm up** (2 min): "Tell me about yourself and your role"
2. **Context** (5 min): "Walk me through how you currently [task]"
3. **Pain points** (10 min): "What's the most frustrating part?" + follow-up "Why?"
4. **Needs** (5 min): "If you could wave a magic wand, what would change?"
5. **Reaction** (5 min): Show prototype/concept, observe reaction before asking
6. **Wrap up** (3 min): "Anything I didn't ask that I should have?"

Rules: Ask open-ended questions. Never lead ("Don't you think X?"). Listen more than talk. Note behavior, not just words.

### Persona Template
```
Name: [Fictional name]
Photo: [Description]
Role: [Job title / life stage]
Age: [Range]
Tech savviness: [Low / Medium / High]

Goals:
- [Primary goal]
- [Secondary goal]

Frustrations:
- [Pain point 1]
- [Pain point 2]

Quote: "[Something they'd actually say]"

Tools they use: [List]
How they'd find us: [Channel]
```

## Information Architecture
- **Card sorting**: ask users to group features/pages into categories
- **Tree testing**: give users a task, see if they find it in your navigation
- **Site map**: max 3 levels deep, max 7 items per level

## Wireframing
When creating wireframes as HTML:
- Use gray boxes for images: `background: #e5e7eb`
- Use placeholder text: "Lorem ipsum" or realistic sample content
- Focus on layout and hierarchy, not visual design
- Show all states: empty, loading, error, populated, overflow

## Usability Heuristics (Nielsen)
1. Visibility of system status (loading states, progress bars)
2. Match between system and real world (familiar language)
3. User control and freedom (undo, back, cancel)
4. Consistency and standards (same patterns throughout)
5. Error prevention (confirmation dialogs for destructive actions)
6. Recognition over recall (show options, don't require memorization)
7. Flexibility (keyboard shortcuts for power users)
8. Aesthetic and minimal design (remove unnecessary elements)
9. Help users recognize and recover from errors (clear error messages)
10. Help and documentation (tooltips, onboarding tours)

## Interaction Patterns
- **Forms**: inline validation, clear labels, logical tab order, autofocus first field
- **Lists**: search, filter, sort, pagination/infinite scroll, empty state
- **Modals**: close on Escape, close on backdrop click, trap focus inside
- **Navigation**: highlight current page, breadcrumbs for deep hierarchy
- **Notifications**: auto-dismiss after 5s, manual dismiss, stack vertically
- **Drag & drop**: visual affordance, ghost preview, drop zone highlight

## Accessibility (A11y)
- Color contrast: 4.5:1 for text, 3:1 for large text
- All images have alt text
- All interactive elements keyboard-accessible
- Use semantic HTML: `<button>` not `<div onclick>`
- ARIA labels for icon-only buttons
- Focus visible on all interactive elements
- Don't rely on color alone for meaning (add icons/text)
