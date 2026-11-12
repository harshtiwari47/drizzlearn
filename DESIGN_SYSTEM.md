# Drizzlearn design and quality system

This document defines how UI changes should fit the supplied Drizzlearn demo and how to catch regressions before they reach learners. The reference Home layout and its typography remain the visual source of truth.

## Product loop

Design each page around this learning cycle:

1. Set a specific learning outcome.
2. Review and approve a feasible course proposal.
3. Complete a focused study session.
4. Demonstrate understanding with practice evidence.
5. Save, revisit, and improve knowledge.

The next useful learner action should be easy to identify. Completed sessions and evidence of understanding stay visually distinct.

## Visual foundations

| Role | Current direction |
| --- | --- |
| Body type | Manrope, readable interface text |
| Display type | Space Grotesk, page and card headings |
| Background | Near black `#090a11` |
| Surfaces | Layered charcoal `#11121d`, `#171827`, `#202136` |
| Primary action | Lavender and violet `#a87cff` / `#8555ff` |
| Meaningful state | Restrained lime for the active navigation marker and completion cues |
| Supporting state | Mint for successful or restorative states |

Keep the demo's type sizes, weights, card hierarchy, rounded corners, subtle borders, and selective violet glow. Use lime for state and progress rather than decoration. Helper text should stay comfortably readable; never rely on color alone to communicate status.

## Component rules

- Reuse the existing panel, button, field, status, card, and empty-state language before introducing a new component style.
- Give every input a visible label and every icon-only control an accessible name.
- Show visible keyboard focus, disabled states, loading states, empty states, and recoverable errors.
- Keep controls touch-sized on mobile and avoid hover-only actions.
- Use semantic headings in order, and use a live status region only for messages that need announcement.
- Keep sensitive credentials and provider requests in Node.js functions. React receives the result, never the provider key.

## Layout and responsive behavior

- Desktop: full labeled sidebar and two-column workspace where content allows it.
- Tablet: compact icon rail with tooltips and accessible labels.
- Mobile: four primary destinations in the bottom bar; secondary tools open from “More”.
- At 360px and above: no horizontal page scrolling, clipped labels, or controls beneath fixed navigation.
- Short desktop windows: sidebar navigation can scroll without hiding its active destination or footer actions.
- Long course titles, large text, zoom, and translated labels must wrap or truncate within their own containers.

## CSS organization

`src/styles.css` has accumulated repeated base, sidebar, and breakpoint rules. That cascade is a primary regression risk. The planned consolidation is:

1. Move color, typography, spacing, radius, border, and focus values into one token section.
2. Keep shared primitives (buttons, fields, panels, status, empty states) together.
3. Keep each page's component styles in one section near related components.
4. Define each responsive breakpoint once at the end, with documented exceptions only.
5. Remove superseded selectors as each component is moved; do not add another append-only patch block.

Consolidate in small page groups and compare the Home screen with the supplied reference after each group. Do not change the established font families or Home heading scale during cleanup.

## Bug-prevention workflow

No process can promise zero defects. Use layered checks so a defect is caught near the change that introduced it:

1. Keep components small and use named helpers for parsing, normalization, timer transitions, and persistence.
2. Validate API input at the boundary; scope every database read and write to the authenticated learner or room membership.
3. Keep serverless state in Postgres or the browser's explicit learner-created local workspace, never a process-global variable. A first visit starts empty; never seed fictional learner records.
4. Validate generated AI output before saving. Keep the prior editable proposal intact if generation or validation fails.
5. Test pure behavior (schemas, timer transitions, retrieval ownership), API behavior, and rendered page structure separately.
6. Apply database changes as idempotent migrations and test them against a clean database and an existing schema.
7. Run `npm test` and `npm run build` after each completed segment.
8. Review visual states at 1440px, 900px, 621px, 620px, 390px, and 360px, plus a short-height desktop window.
9. Use keyboard-only checks for navigation, dialogs, room controls, forms, and error recovery.
10. Before deployment, test empty, loading, provider-limit, database-unavailable, and stale-session paths.

## AI response contract

Course proposals are drafts until the learner approves them. The server accepts a proposal only when it has:

- A title, goal summary, duration, assumptions, and ordered modules.
- Measurable module and lesson objectives.
- Prerequisites that point to earlier content.
- Lesson explanation, worked example, estimated effort, and a complete checkpoint.
- Source references that match retrieved learner-owned material; fabricated IDs and citations are discarded.
- A calculated total effort and weekly-feasibility result.

The user can edit the draft or request a revision with specific feedback. A provider limit, timeout, or invalid response leaves the current draft available to edit or retry.
