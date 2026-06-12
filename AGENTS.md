<!-- BEGIN:nextjs-agent-rules -->
# Next.js 16 — conventions already in place

This project is on Next.js 16.2.9 (App Router, Turbopack) and is fully migrated to v16 conventions. Follow the existing patterns — do not reintroduce pre-16 idioms:

- **`proxy.ts`, not `middleware.ts`** — root-level `proxy.ts` exports a function named `proxy`. There is no middleware file.
- **Request APIs are async** — `cookies()` (see `lib/auth.ts`, `lib/dal.ts`), `headers()`, and page `params`/`searchParams` must be awaited.
- **Turbopack is the default** bundler for `next dev` and `next build`; its config lives at the top level of `next.config.ts` (not under `experimental`).
- **ESLint flat config** (`eslint.config.mjs`) with the `eslint` CLI — `next lint` no longer exists.
- Full local API reference: `node_modules/next/dist/docs/` (upgrade guide at `01-app/02-guides/upgrading/version-16.md`).
<!-- END:nextjs-agent-rules -->

# Project: fordra-coi-app

COI (certificate of insurance) verification app.

## Stack
- Next.js 16.2.9, React 19, TypeScript, Tailwind v4
- Anthropic SDK (document analysis), Retell SDK (phone calls), Vercel Postgres + Blob
- Dev: `npm run dev` (loads `.env.local` automatically)

## Structure (three paths from `/`)
- `/` — path selector (Demo / App / Admin buttons)
- `app/demo/` — the original end-to-end demo flow (`AppClient.tsx`, self-contained with inline styles + its own copy of the design tokens). Wired to the real API routes: `verify`, `call`, `call-status`, `parse-transcript`, `final-report`
- `app/app/` — design-partner control center (sidebar layout): `home`, `upload`, `status`, `docs`. **UI scaffold on mock data** (`lib/mock.ts`) — no backend yet
- `app/admin/` — admin ops (sidebar layout): `dashboard`, `verifications` (+ `CompletionFlow.tsx` for pending → completed). **Mock data, client-state only**
- `components/ui/` — shared design system for App/Admin paths: `tokens.ts` (the `C` object), `primitives.tsx`, `DropZone`, `ManualRequirementsForm`, `QuestionListEditor`, `StatCard`, `DataTable`, `Modal`, `CodeBlock`, `Sidebar`, `report.tsx`. These are deliberate copies of patterns in `app/demo/AppClient.tsx` — do NOT refactor the demo to import them; the demo stays self-contained
- `components/{GapTable,ReportView,StatusBadge}.tsx` — old dark-theme components, parked/unused
- `lib/` — `auth.ts` / `dal.ts` (parked cookie session auth), `claude.ts` (Anthropic analysis), `retell.ts` (call client), `types.ts`, `mock.ts` (mock verifications/users/stats, shapes aligned with `types.ts`)

## Auth — DISABLED for the scaffold iteration
`proxy.ts` is a pass-through. Do not "fix" it back. The old single-password gate (`APP_PASSWORD`, `lib/auth.ts`, `/api/auth`) is parked and will return as per-path auth when backend wiring lands.
