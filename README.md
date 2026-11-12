# Drizzlearn

Drizzlearn is a goal-first learning workspace based on the supplied SRS. The original `LearnOS (4).html` is preserved as the Home UI reference. The React Home keeps its structure, typography, colors, and card hierarchy; the rest of the SRS features use the same visual system.

## What is implemented

See [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) for the visual rules and bug-prevention workflow.

- Home with current course, roadmap, week/month timeline, due reviews, and task/evidence summaries.
- Grouped desktop navigation, compact tablet rail, and a mobile “More” menu for secondary tools.
- Study Together rooms with invite codes, presence, and a room-wide Pomodoro timer. Signed-in rooms use Postgres; locally created rooms stay on the current device until an account is connected.
- Goal creation, editable course proposals, weekly-budget feasibility, and explicit approval before sessions are scheduled.
- Course drafts built by separate curriculum, lesson-content, and assessment agents, with learner notes and practice history retrieved as grounded context.
- Proposal revisions from learner feedback, validated before replacing the editable draft, with retrieved source references shown in the proposal.
- Course library, course roadmap, lesson reading, objectives, worked examples, and checkpoint evidence.
- Today’s study plan, task start/completion, rescheduling, and retained attempts/notes.
- Editable lesson-linked notes and note drafting; flashcard creation and spaced review ratings.
- Practice checkpoints, four AI Tutor modes, progress/evidence views, learner settings, account flows, and data export.
- Node.js API routes in `api/[...path].js`, deployed as Vercel Functions, with Postgres persistence, NVIDIA NIM integration, and optional Resend password-reset email.

Without an account, Drizzlearn opens to an empty workspace and keeps only learner-created local drafts in browser storage. No courses, notes, flashcards, tasks, or progress are preloaded. Account data is stored through the API and Postgres; serverless process memory is never used as durable storage.

## Local development

```sh
npm install
npm run dev
```

`npm run dev` starts Vite for the local UI. For the Node API functions, link/authenticate the Vercel CLI and start `npm run dev:vercel`.

## Vercel setup

1. Import this project into Vercel. Vite builds into `dist`; API files under `/api` are deployed as Node.js Functions.
2. Add a Postgres provider from the Vercel Marketplace and set `DATABASE_URL` for the deployment.
3. Set `SESSION_SECRET` to a random value of at least 32 characters and set `APP_URL` to the deployed site URL.
4. Pull the deployment variables into a local environment, then run `npm run db:migrate` once to create the schema in `db/schema.sql`.
5. Set `NVIDIA_API_KEY` in Vercel's encrypted environment variables and `NVIDIA_MODEL` to an enabled NVIDIA NIM model. The default base URL is `https://integrate.api.nvidia.com/v1`; you can override it with `NVIDIA_BASE_URL`. You can also configure `GEMINI_API_KEY` (and optionally `GEMINI_MODEL`, defaulting to `gemini-flash-latest`, and `GEMINI_BASE_URL` defaulting to `https://generativelanguage.googleapis.com/v1beta/openai`). When configured, if NVIDIA encounters errors, rate limits, or is unavailable, the server automatically and seamlessly falls back to Gemini for course generation and AI tutoring. The server runs the course planner, lesson designer, and assessment designer separately, then validates the combined proposal. Tutor retrieval is restricted to the signed-in learner's own notes, lessons, and practice history. If all providers are unavailable, the app reports the failure and keeps the learner's current draft intact; it does not invent a sample course or tutor response.
6. Set `RESEND_API_KEY` and `EMAIL_FROM` only if you want password-reset emails. Account creation now activates the account and signs the learner in without email verification.

Never commit `.env.local` or deployment secrets. `.env.example` lists the supported variables.

## Main API areas

`/api/auth/*`, `/api/home`, `/api/goals`, `/api/courses`, `/api/study-rooms`, `/api/lessons`, `/api/tasks`, `/api/notes`, `/api/flashcards`, `/api/practice`, `/api/tutor`, `/api/progress`, `/api/search`, and `/api/settings`.

Every learner-data query is scoped to the authenticated user. Checkpoints keep attempts as evidence; a study task completes only after a passing checkpoint. Missed or rescheduled tasks remain incomplete, and saved notes/attempts are not removed when dates move.
