# Fordra — COI Verification Tool

## Context

Fordra is a COI (Certificate of Insurance) verification platform for freight factoring companies. The existing repo is a static landing page (`COI landing page/`) deployed to Vercel. This plan builds the actual product as a new **Next.js 15 app** (`fordra-app/`) in the same working directory, linked to the same Vercel project. The tool automates an 8-step verification pipeline: document ingestion → OCR → gap analysis → AI phone call → transcript analysis → final report.

---

## Tech Stack

| Concern | Choice |
|---|---|
| Framework | Next.js 15 (App Router, TypeScript) |
| Styling | Tailwind CSS (matching brand: Inter, `#0a0a0a`, white/muted palette) |
| AI extraction | Claude API (`claude-sonnet-4-6`) with vision |
| AI calling | Retell AI (outbound phone + transcript webhook) |
| File storage | Vercel Blob |
| Database | Vercel Postgres (Neon, pooled) |
| Deploy | Vercel (same project, root dir = `fordra-app/`) |

---

## Phase 0 — Prerequisites (Before Any Code)

1. **Retell AI**: Create agent "Fordra COI Verifier" (Single Prompt type). Note `agent_id`. Buy/import a from-number. Get API key. Set webhook URL to `https://fordra.com/api/webhooks/retell` after deploy.
2. **Vercel Postgres**: Add Neon store to Vercel project → get `POSTGRES_URL` (pooled connection string).
3. **Vercel Blob**: Enable → get `BLOB_READ_WRITE_TOKEN`.
4. **Anthropic**: Get `ANTHROPIC_API_KEY`.

ENV vars for `.env.local`:
```
ANTHROPIC_API_KEY
RETELL_API_KEY
RETELL_AGENT_ID
RETELL_FROM_NUMBER        # E.164 format
RETELL_WEBHOOK_SECRET     # same value as RETELL_API_KEY
BLOB_READ_WRITE_TOKEN
POSTGRES_URL
NEXT_PUBLIC_BASE_URL=https://fordra.com
```

---

## Phase 1 — Scaffold

```bash
npx create-next-app@latest fordra-app --typescript --tailwind --app --no-src-dir --import-alias "@/*"
cd fordra-app
npm install @anthropic-ai/sdk retell-sdk @vercel/blob @vercel/postgres
```

- Extend `tailwind.config.ts` with brand colors: `bg:#0a0a0a`, `white:#ffffff`, `muted:rgba(255,255,255,0.4)`, `border:rgba(255,255,255,0.08)`.
- Add Inter via Google Fonts in `app/layout.tsx` (same link tag as landing page).
- Migrate landing page content into `app/page.tsx` as a React/Tailwind component (preserving the existing design). Keep the Formspree endpoint (`https://formspree.io/f/mzdwgrja`).

---

## Phase 2 — Database

**File: `lib/types.ts`** — define first, everything depends on this.

Key types: `CaseStatus` enum, `Requirement`, `COIExtracted`, `GapItem`, `GapAnalysis`, `FinalReport`, `VerificationCase`.

```ts
type CaseStatus = 'pending_docs' | 'ocr_complete' | 'ready_for_call'
                | 'call_in_progress' | 'call_complete' | 'report_ready'
```

**SQL schema** (run once via Vercel dashboard or `psql`):

```sql
CREATE TYPE case_status AS ENUM (
  'pending_docs','ocr_complete','ready_for_call',
  'call_in_progress','call_complete','report_ready'
);

CREATE TABLE cases (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  carrier_name           TEXT,
  status                 case_status NOT NULL DEFAULT 'pending_docs',
  requirements_doc_url   TEXT,
  requirements_parsed    JSONB,
  coi_doc_url            TEXT,
  coi_extracted          JSONB,
  gap_analysis           JSONB,
  agent_questions        JSONB,
  insurance_agent_phone  TEXT,
  retell_call_id         TEXT,
  call_transcript        TEXT,
  call_extracted_answers JSONB,
  final_report           JSONB
);

CREATE INDEX idx_cases_retell_call_id ON cases (retell_call_id)
  WHERE retell_call_id IS NOT NULL;
```

**File: `lib/db.ts`** — thin wrapper around `@vercel/postgres`. Use `sql` tagged template literals only (no string concatenation). Write explicit update functions per status transition rather than a dynamic builder.

---

## Phase 3 — Claude Service (`lib/claude.ts`)

Six focused functions. All use `claude-sonnet-4-6`. All instruct Claude to return **only valid JSON** (no fences, no prose). Wrap every `JSON.parse` in try/catch with one retry appending: *"Return ONLY the JSON, no markdown, no explanation."*

| Function | Input | Output | `max_tokens` |
|---|---|---|---|
| `parseRequirements(docText)` | raw text from requirements doc | `Requirement[]` | 2048 |
| `extractCOIFields(base64, mediaType)` | COI image as base64 | `COIExtracted` | 4096 |
| `analyzeGaps(requirements, extracted)` | both JSON objects | `GapAnalysis` | 2048 |
| `generateAgentQuestions(gaps)` | gap analysis | `string[]` (max 8) | 1024 |
| `parseTranscript(transcript, questions)` | transcript + question array | `Record<string, string>` | 2048 |
| `generateFinalReport(gapAnalysis, callAnswers)` | gaps + answers | `FinalReport` | 2048 |

**COI extraction uses Claude Vision** — pass the image as a base64 `image` content block. For MVP, accept JPEG/PNG only (no PDFs) to avoid ImageMagick dependency. Note PDF support as a follow-up.

---

## Phase 4 — Retell Service (`lib/retell.ts`)

```ts
// Initiate outbound call — returns retell_call_id
export async function initiateVerificationCall(params: {
  toNumber: string;
  truckingCompanyName: string;
  agentName: string;
  questionsList: string;  // newline-separated, formatted before passing
}): Promise<string>

// Validate incoming webhook HMAC signature
export function verifyWebhookSignature(rawBody: string, signature: string): boolean
```

**Retell agent system prompt** (set in Retell dashboard):
- Introduces as "Alex from Fordra"
- States purpose: verifying COI for `{{trucking_company_name}}`
- Asks `{{questions_list}}` one question at a time, confirms each answer
- Keeps call under 8 minutes
- Does not interpret coverage — only records what agent says

**Note:** `retell_llm_dynamic_variables` values must all be strings. Format the questions array as a numbered newline-separated string before passing.

---

## Phase 5 — API Routes

```
app/api/
  cases/
    route.ts               POST: create case + parse requirements
    [id]/
      route.ts             GET: fetch case  |  PATCH: update questions
      coi/route.ts         POST: upload COI + run OCR
      analyze/route.ts     POST: gap analysis + generate questions
      call/route.ts        POST: initiate Retell call
  webhooks/
    retell/route.ts        POST: receive transcript, parse, generate report
```

**Pipeline per route:**

1. `POST /api/cases` → upload requirements to Blob → extract text → `parseRequirements()` → INSERT row (status: `pending_docs`, requirements populated)
2. `POST /api/cases/[id]/coi` → upload COI to Blob → base64 encode → `extractCOIFields()` → UPDATE status: `ocr_complete`
3. `POST /api/cases/[id]/analyze` → `analyzeGaps()` + `generateAgentQuestions()` → UPDATE status: `ready_for_call`
4. `POST /api/cases/[id]/call` → validate E.164 phone → `initiateVerificationCall()` → UPDATE status: `call_in_progress`, store `retell_call_id`
5. `POST /api/webhooks/retell` (critical implementation notes below):
   - Read raw body with `await req.text()` — **do not use `req.json()`** (breaks HMAC verification)
   - Verify `x-retell-signature` header via `Retell.verify()`; return 401 if invalid
   - On `call_ended`: UPDATE status → `call_complete`
   - On `call_analyzed` (~30–90s later, transcript complete): `parseTranscript()` → `generateFinalReport()` → UPDATE status → `report_ready`
   - Return 200 immediately (Retell expects fast acknowledgment)

**Vercel timeout**: Add `export const maxDuration = 60` to routes calling Claude (requires Vercel Pro). OCR on a complex COI can take 15–25s.

---

## Phase 6 — Pages & Components

```
app/
  layout.tsx              Inter font, dark bg
  page.tsx                Landing page (migrated from static HTML)
  app/
    page.tsx              /app — case list dashboard
    new/page.tsx          /app/new — create case
    case/[id]/page.tsx    /app/case/[id] — full pipeline UI
```

**Case detail page** renders panels conditionally by `case.status`. Poll every 5s during `call_in_progress` using SWR or `setInterval` + `router.refresh()`.

| Status | Panel shown |
|---|---|
| `pending_docs` | FileUpload for COI |
| `ocr_complete` | Extracted COI fields (read-only) + "Run Analysis" button |
| `ready_for_call` | GapTable + QuestionEditor + phone input + "Start Call" button |
| `call_in_progress` | Spinner + elapsed time |
| `call_complete` | Full transcript text |
| `report_ready` | ReportView — Met / Not Met / Uncertain tables + narrative summary + "Download" (window.print) |

**Components:**
- `FileUpload.tsx` — drag-and-drop, accepts `image/*` only (MVP), 10MB client-side limit
- `StatusBadge.tsx` — color-coded pill per status
- `GapTable.tsx` — three collapsible sections, columns: Coverage Type / Required / Found / Evidence
- `QuestionEditor.tsx` — editable list of agent questions before call
- `CallPanel.tsx` — phone input with US formatting, question count, initiate button
- `ReportView.tsx` — final report + print stylesheet

---

## Phase 7 — Deploy

```bash
cd fordra-app
vercel link              # link to existing "fordra" Vercel project
# Set Root Directory = fordra-app/ in Vercel project settings
vercel --prod
```

After deploy: update Retell webhook URL in Retell dashboard to `https://fordra.com/api/webhooks/retell`.

---

## Build Order (Dependencies)

```
Phase 0 (accounts + credentials)
  → Phase 1 (scaffold + Tailwind + landing page migration)
  → Phase 2 (types.ts → db schema → db.ts)
  → Phase 3 (claude.ts — all 6 prompt functions)
  → Phase 4 (retell.ts)
  → Phase 5 (API routes: cases → coi → analyze → call → webhook)
  → Phase 6 (pages + components, start with /app/new)
  → Phase 7 (deploy + webhook URL update)
```

---

## Critical Files

| File | Why critical |
|---|---|
| `lib/types.ts` | All routes and components depend on these types |
| `lib/claude.ts` | Core AI logic for all 6 pipeline steps |
| `lib/retell.ts` | AI calling integration; webhook signature verification |
| `lib/db.ts` | All routes depend on this for case state |
| `app/api/webhooks/retell/route.ts` | Most complex route; must read raw body, verify HMAC, handle two event types |
| `app/app/case/[id]/page.tsx` | Entire pipeline UX lives here |

---

## Verification (End-to-End Test)

1. Download a sample ACORD 25 from acord.org; screenshot as PNG
2. Create a text file with sample requirements: "Auto Liability: $1M, Cargo: $100k, GL: $1M/$2M aggregate"
3. Upload requirements → verify `requirements_parsed` JSON in DB is correct
4. Upload COI PNG → verify `coi_extracted` JSON captures named insured, coverage rows, limits
5. Run analysis → verify `gap_analysis` has sensible met/not_met/uncertain split
6. Review generated questions → check they address uncertain/missing items specifically
7. Use a test phone number (Twilio test number or your own cell) → initiate call
8. Speak answers into the call → verify `call_transcript` is populated after webhook fires
9. Check `final_report` — verify uncertain items were updated based on spoken answers
10. View report page → confirm three-section layout with narrative summary
