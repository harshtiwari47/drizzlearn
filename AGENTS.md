# Drizzlearn contributor and agent workflow

## Product constraints

- Use Drizzlearn as the product name and the supplied Home reference's Manrope and Space Grotesk typography, dark surfaces, and restrained violet/lime accents.
- New accounts and first visits start with no fictional courses, notes, cards, tasks, progress, or room participants.
- Keep learner-created local drafts distinct from server-backed account data, and preserve real learner data when migrating storage.
- Show explicit empty, loading, unavailable, and recoverable-error states. Never replace a failed service response with invented content.

## Parallel review roles

For substantial feature segments, use three bounded subagent workstreams:

1. **UI and accessibility:** review the visual reference, responsive behavior, keyboard access, and empty/loading/error states. Own `src/styles.css` or an explicitly assigned UI component.
2. **Logic and feature flow:** trace the learner journey end to end, including React state, API validation, authenticated ownership, persistence, retries, and failure recovery. Own assigned `src/`, `server/`, `api/`, or `db/` files.
3. **Tests and regression review:** turn user journeys and reported bugs into focused automated cases, run them, and report uncovered paths. Own `tests/` unless the task explicitly assigns another area.

Keep file ownership disjoint while agents work. The primary agent integrates the changes, resolves cross-layer issues, and runs the full test suite and production build after integration. Ask for a second review pass on fixes found during the first pass.

Subagents are task-scoped; start or follow up on them for each substantial work segment rather than treating them as persistent background processes.
