import Anthropic from '@anthropic-ai/sdk';
import { curlFetch } from './anthropic-fetch';
import { parseStandardLine } from './templates';
import { corporateEmailDomain, deriveLegitimacy } from './contact-notes';
import type {
  Requirement,
  COIExtracted,
  GapAnalysis,
  FinalReport,
  NoteContactCheck,
  ContactCheckEntry,
  WebsiteStatus,
  ExternalConfirmation,
} from './types';

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) {
    const opts: ConstructorParameters<typeof Anthropic>[0] = {
      apiKey: process.env.ANTHROPIC_API_KEY,
      maxRetries: 5,
    };
    // Local dev: route through the system curl to dodge a Node TLS bug that
    // corrupts large uploads on this machine. Production (Vercel) uses native fetch.
    if (!process.env.VERCEL) opts.fetch = curlFetch as unknown as typeof fetch;
    _client = new Anthropic(opts);
  }
  return _client;
}
const MODEL = 'claude-sonnet-4-6';
// The contact web check runs on Haiku (owner cost cap 2026-07-22: <=$0.20 a
// run, ~$0.10 average — Sonnet's server-tool loop billed ~$0.36). The task is
// mechanical (fetch site, compare values, one directory search) and the
// verdict is derived in code, so the cheaper model holds up.
const CONTACT_CHECK_MODEL = 'claude-haiku-4-5';
const CONTACT_CHECK_RATES = { inputPerM: 1, outputPerM: 5, perSearch: 0.01 };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractJSON(raw: string): string {
  // Strip markdown code fences if present
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  // Find outermost JSON object or array
  const start = raw.search(/[{[]/);
  const end = Math.max(raw.lastIndexOf('}'), raw.lastIndexOf(']'));
  if (start !== -1 && end !== -1 && end > start) return raw.slice(start, end + 1);
  return raw.trim();
}

async function callClaude(
  system: string,
  messages: Anthropic.MessageParam[],
  maxTokens: number,
): Promise<string> {
  const res = await getClient().messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages,
  });
  const block = res.content[0];
  if (block.type !== 'text') throw new Error('Unexpected non-text response from Claude');
  return block.text;
}

async function claudeJSON<T>(
  system: string,
  messages: Anthropic.MessageParam[],
  maxTokens: number,
): Promise<T> {
  let raw = await callClaude(system, messages, maxTokens);
  try {
    return JSON.parse(extractJSON(raw)) as T;
  } catch {
    // Retry with stricter instruction
    const retryMessages: Anthropic.MessageParam[] = [
      ...messages,
      { role: 'assistant', content: raw },
      {
        role: 'user',
        content:
          'Your response could not be parsed as JSON. Return ONLY valid JSON — no markdown fences, no explanation, nothing else.',
      },
    ];
    raw = await callClaude(system, retryMessages, maxTokens);
    return JSON.parse(extractJSON(raw)) as T;
  }
}

// ─── Media helpers ────────────────────────────────────────────────────────────

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
const IMAGE_TYPES = new Set<string>(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

/**
 * Build a Claude content block for a file.
 * Images → image block. PDFs → document block (native API support, no conversion).
 */
function fileContentBlock(base64: string, mediaType: string): Anthropic.Messages.ContentBlockParam {
  if (mediaType === 'application/pdf') {
    return {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: base64 },
    } as unknown as Anthropic.Messages.ContentBlockParam;
  }
  return {
    type: 'image',
    source: { type: 'base64', media_type: mediaType as ImageMediaType, data: base64 },
  };
}

// ─── 1. Extract plain text from an image or PDF (used for requirements docs) ─

export const DEFAULT_DOC_TEXT_PROMPT =
  'Extract and return all text from this document exactly as written. No formatting, no summary — just the raw text content.';

export async function extractTextFromFile(
  base64: string,
  mediaType: string,
  promptOverride?: string,
): Promise<string> {
  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: [
        fileContentBlock(base64, mediaType),
        { type: 'text', text: promptOverride?.trim() || DEFAULT_DOC_TEXT_PROMPT },
      ],
    },
  ];
  return callClaude('You are a document text extractor.', messages, 2048);
}

// Keep old name as alias so nothing else breaks
export const extractTextFromImage = extractTextFromFile;

// ─── 2. Parse insurance requirements ─────────────────────────────────────────

export const DEFAULT_REQUIREMENTS_PARSING_PROMPT = `You are an insurance requirements analyst for a freight factoring company.
Extract insurance requirements from the provided document text. Three kinds count:
1. Coverage requirements: a coverage type with a minimum limit (e.g. auto liability $1,000,000).
2. Stated restrictions or conditions on the insurance: cargo/commodity restrictions ("no helicopters", "no hazmat"), radius limits, equipment or trailer conditions, endorsement demands, deductible caps. These ARE requirements even though they have no dollar limit: set coverage_type to a short label (e.g. "Restriction: No Helicopter Cargo"), minimum_limit to "", and describe the restriction in notes.
3. Verification conditions: checks the certificate itself must satisfy, e.g. the policyholder/named insured matching a given carrier name, every policy being currently active/in force, or a required certificate holder, loss payee, or additional insured listing. Set coverage_type to the check's short name (e.g. "Matching Policyholder Name"), minimum_limit to "", and describe the exact check in notes.
Ignore non-insurance regulatory items: FMCSA compliance, safety ratings, licensing, authority checks.
Return ONLY a valid JSON array. No prose, no markdown fences.
Each element must have: coverage_type (string), minimum_limit (string), notes (string or null).
minimum_limit holds the stated dollar amount. Amounts are minimums by default in insurance; when the document states a different direction for an amount ("no more than", "maximum deductible", "exactly", a range), preserve that qualifier wording in notes so downstream analysis judges it correctly.
Only include requirements explicitly stated in the document; do not invent any. If a field is absent, use null.`;

export async function parseRequirements(docText: string, promptOverride?: string): Promise<Requirement[]> {
  const system = promptOverride?.trim() || DEFAULT_REQUIREMENTS_PARSING_PROMPT;
  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: `Document text:\n<document>\n${docText}\n</document>\n\nReturn the JSON array of requirements now.`,
    },
  ];

  return claudeJSON<Requirement[]>(system, messages, 2048);
}

/**
 * Strict variant for the submitter's own standards, which are line-structured
 * (one standard per line — templates serialize "Type: limit (notes)", manual
 * entry follows the same shape). Guarantees EXACTLY one requirement per line,
 * in order: the model may not merge overlapping lines (seen live: a separate
 * "Vehicle VIN" line swallowed by a broader "Vehicle listed" line), drop
 * lines, or invent extras. When the model breaks the contract anyway, falls
 * back to a deterministic per-line parse — so a submitted standard can never
 * silently vanish from the requirement checks.
 *
 * coverage_type is ALWAYS the submitter's own title, taken deterministically
 * from the line (seen live: "Insured at purchase amount" relabeled to a vague
 * "Physical Damage", VRF-1056). The model only fills minimum_limit and notes.
 */
export async function parseRequirementLines(lines: string[], promptOverride?: string): Promise<Requirement[]> {
  if (!lines.length) return [];
  const base = promptOverride?.trim() || DEFAULT_REQUIREMENTS_PARSING_PROMPT;
  const system = `${base}

STRICT LINE CONTRACT — the input is the customer's own list of insurance standards, ONE standard per numbered line:
- Return EXACTLY ${lines.length} requirement objects: one per line, in line order.
- NEVER merge two lines into one object, even when they overlap or one looks redundant (e.g. a "vehicle listed" line and a separate "vehicle VIN" line each get their own object).
- NEVER drop a line, and never add objects that have no line.
- coverage_type is a short label for THAT line; carry the line's full condition wording in notes and its stated amount in minimum_limit.`;
  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: `Insurance standards (${lines.length} lines):\n${lines.map((l, i) => `${i + 1}. ${l}`).join('\n')}\n\nReturn the JSON array of exactly ${lines.length} requirements now.`,
    },
  ];
  try {
    const parsed = await claudeJSON<Requirement[]>(system, messages, 4096);
    if (Array.isArray(parsed) && parsed.length === lines.length) {
      return parsed.map((r, i) => ({ ...r, coverage_type: parseStandardLine(lines[i]).title }));
    }
    console.error(`parseRequirementLines: contract violated (${lines.length} lines -> ${Array.isArray(parsed) ? parsed.length : 'non-array'}); using deterministic per-line fallback`);
  } catch (e) {
    console.error('parseRequirementLines: model call failed; using deterministic per-line fallback', e);
  }
  return lines.map(line => {
    const r = parseStandardLine(line);
    return { coverage_type: r.title, minimum_limit: r.limit ?? '', notes: r.notes ?? null };
  });
}

/**
 * Merge a submitter's free-text amendment into their saved standard's
 * serialized lines (Slack "use it, but ..." path). Rewrites/removes/adds only
 * the lines the amendment touches and keeps the rest verbatim — appending the
 * raw amendment instead would leave two conflicting lines (e.g. the old $1M
 * and the new $2M) that the strict line parser turns into contradictory
 * requirements. On any model failure it appends the amendment as its own
 * overriding line, so an amendment can never silently vanish.
 */
export async function applyStandardAmendment(lines: string[], amendment: string): Promise<string[]> {
  const system = `You maintain a customer's list of insurance standards for COI verification. The list has ONE standard per line, shaped like "Title: amount (description)" or a free-text condition.
Apply the customer's amendment to the list:
- Rewrite only the line(s) the amendment clearly changes; keep every other line VERBATIM, in order.
- If the amendment removes a standard, delete that line. If it adds one, append a new line in the same shape.
- If any part of the amendment does not clearly map to an existing line, append it as a new line; never drop or ignore any part of the amendment.
Return ONLY a valid JSON array of strings: the full revised list, one standard per string, without the line numbers. No prose, no markdown fences.`;
  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: `Current standards (${lines.length} lines):\n${lines.map((l, i) => `${i + 1}. ${l}`).join('\n')}\n\nCustomer's amendment:\n${amendment}\n\nReturn the revised JSON array of lines now.`,
    },
  ];
  try {
    const out = await claudeJSON<string[]>(system, messages, 2048);
    const clean = Array.isArray(out) ? out.filter(x => typeof x === 'string').map(x => x.trim()).filter(Boolean) : [];
    if (clean.length) return clean;
    console.error('applyStandardAmendment: empty/invalid model output; appending amendment as its own line');
  } catch (e) {
    console.error('applyStandardAmendment: model call failed; appending amendment as its own line', e);
  }
  return [...lines, `Amendment to the standards above (this overrides any conflicting line): ${amendment}`];
}

// ─── 3. Extract COI fields via Vision ────────────────────────────────────────

export const DEFAULT_COI_EXTRACTION_PROMPT = `You are an expert at reading ACORD 25 Certificates of Insurance with forensic precision.
Every legal entity name, policy number, and coverage limit must match the document exactly — character for character.

CRITICAL FIELDS — read with extreme care:
- named_insured: The exact legal name of the policyholder printed in the "Named Insured" box (typically top-left). Include LLC, Inc, Corp, DBA, and any suffixes exactly as written. This is who the policy covers.
- named_insured_address: The policyholder's street address as printed in the Named Insured box. Use "" if not shown.
- named_insured_phone / named_insured_email: The policyholder's phone and email if printed on the certificate. Use "" if not shown.
- usdot_number: The USDOT number printed anywhere on the certificate (often in the description box, e.g. "USDOT 1234567"). Digits only, no prefix. Use "" if not shown.
- mc_number: The MC (motor carrier authority) number printed anywhere on the certificate (e.g. "MC 987654"). Digits only, no prefix. Use "" if not shown.
These identity fields matter: they confirm the certificate belongs to the right carrier.
- producer: The agency or brokerage name from the "Producer" box (top-left of form). This is who issued the certificate and is the primary contact for verification calls.
- insurance_company: The insurer legal entity name(s) from the lettered insurer boxes (A, B, C…). If more than one insurer is listed, include ALL of them, comma separated, in box-letter order (e.g. "Progressive Casualty Ins Co, Great West Casualty Co"). Do NOT use the producer/broker here.
- insurance_company_address: Street address of the producer/agent listed on the form. If absent, use the primary insurer's address.
- insurance_company_phone: Phone number of the producer/agent. Use "" if not found.
- insurance_company_email: Email of the producer/agent. Use "" if not found.
- insurance_company_contact: The name(s) of any contact person printed for the producer/agent or insurer (e.g. the "Contact Name" box on ACORD 25). Comma separate multiple names. Use "" if none shown.
- loss_payee: Any entity named as loss payee anywhere on the certificate (Description of Operations, certificate holder box wording like "loss payee", endorsement lists). Copy the entity name(s) exactly; comma separate multiple. Use "" if none stated.
- additional_insured: Any entity named as additional insured, whether in a dedicated box, the Description of Operations, or an endorsement list. Comma separate multiple. Use "" if none stated.
- certificate_holder_name / certificate_holder_address: The Certificate Holder box, SPLIT into the entity name (first line(s): the legal entity, e.g. "Dakota Financial LLC") and its mailing address (the remaining lines). certificate_holder keeps the whole box verbatim as before. Use "" for either part if not shown.
- vehicle_vins: Every 17-character Vehicle Identification Number printed anywhere on the certificate (Description of Operations, vehicle or equipment schedules, remarks). Copy each character by character, exactly as printed. Use [] if none.
- other_named_parties: OWNER-OPERATOR SEARCH — many certificates are issued under a fleet or program policy where the actual operator is NOT the named insured. Search the ENTIRE document for every other person or business named anywhere: scheduled drivers, listed operators, DBA names, lessees, parties in the Description of Operations, endorsement schedules, or remarks. For each, give the name and where it appears, e.g. "John Delgado (listed as scheduled driver); JD Hauling LLC (DBA in Description of Operations)". Use "" if none.
- policy_number: Read each alphanumeric character by character. Do not truncate, guess, or normalize. Note ambiguous characters (0 vs O, 1 vs l) in raw_notes.
- conditions_and_exceptions (per coverage): Types of goods or cargo covered, situations covered, exclusions, sub-limits, endorsements, or any restrictions on the coverage. Copy relevant text verbatim. Use "" if none stated.

FIELD LOCATIONS — bounding boxes for highlighting regions on the original document:
- For each coverage row and each region in field_locations, report where it sits on the document: "page" is the 1-based page number; "box" is [x_left, y_top, x_right, y_bottom] as PERCENTAGES of that page's full width and height (numbers 0-100). y=0 is the very TOP edge of the page image (including any margin above the title), y=100 the very bottom edge.
- Each box must cover the ENTIRE printed box or table row for that region, edge to edge — the whole coverage row including its type, policy number, dates, and limits columns; the whole Producer box; the whole Certificate Holder box, and so on.
- CALIBRATE CAREFULLY: boxes are commonly reported too low on the page. Before finalizing each box, verify that the region's FIRST line of text sits just below y_top and its LAST line sits just above y_bottom, and that no neighboring row's text falls inside the box. Adjacent coverage rows must not overlap: each row's y_bottom is the next row's y_top.
- A coverage's location is its full row (or row group) in the coverage table. description_of_operations is the Description of Operations / Remarks box. additional_insured is the dedicated additional-insured box if one exists, otherwise null.
- If you cannot locate a region confidently, use null for its location. Never guess.

Return ONLY a valid JSON object — no prose, no markdown:
{
  "named_insured": string,
  "named_insured_address": string,
  "named_insured_phone": string,
  "named_insured_email": string,
  "usdot_number": string,
  "mc_number": string,
  "producer": string,
  "insurance_company": string,
  "insurance_company_address": string,
  "insurance_company_phone": string,
  "insurance_company_email": string,
  "insurance_company_contact": string,
  "named_insured_state": string,
  "certificate_holder": string,
  "certificate_holder_name": string,
  "certificate_holder_address": string,
  "vehicle_vins": [string],
  "additional_insured": string,
  "loss_payee": string,
  "other_named_parties": string,
  "additional_terms": string,
  "coverages": [
    {
      "type": string,
      "insurer": string,
      "policy_number": string,
      "effective_date": string,
      "expiration_date": string,
      "each_occurrence_limit": string,
      "aggregate_limit": string,
      "conditions_and_exceptions": string,
      "additional_insured": string,
      "loss_payee": string,
      "raw_notes": string,
      "location": { "page": number, "box": [number, number, number, number] } | null
    }
  ],
  "field_locations": {
    "producer": { "page": number, "box": [number, number, number, number] } | null,
    "insured": { "page": number, "box": [number, number, number, number] } | null,
    "insurers": { "page": number, "box": [number, number, number, number] } | null,
    "certificate_holder": { "page": number, "box": [number, number, number, number] } | null,
    "additional_insured": { "page": number, "box": [number, number, number, number] } | null,
    "description_of_operations": { "page": number, "box": [number, number, number, number] } | null
  }
}
Per-coverage additional_insured / loss_payee: the entity holding that status on THAT specific coverage line, when the certificate ties it to a coverage (e.g. additional insured on liability, loss payee on physical damage). Use "" when not tied to the coverage.
named_insured_state: 2-letter US state from named insured's address (e.g. "FL", "TX"). Use "" if not found.
additional_terms: the certificate's free-text terms verbatim: the Description of Operations box, remarks, limitations, warranties, cancellation-notice wording, and any endorsements listed. Use "" if none.
All other missing or illegible fields: use "". Never guess entity names or policy numbers.`;

export async function extractCOIFields(
  base64: string,
  mediaType: string,
  promptOverride?: string,
): Promise<COIExtracted> {
  const system = promptOverride?.trim() || DEFAULT_COI_EXTRACTION_PROMPT;
  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: [
        fileContentBlock(base64, mediaType),
        {
          type: 'text',
          text: 'Extract all fields from this Certificate of Insurance. Return only the JSON object.',
        },
      ],
    },
  ];

  return claudeJSON<COIExtracted>(system, messages, 4096);
}

// ─── 4. Assessment (verdicts + summary) ──────────────────────────────────────

/** Default system prompt for the Analysis-tab assessment; admin-editable on
 *  /admin/settings (app_config key prompt_assessment). The current date is
 *  appended in code so the stored override never goes stale. */
export const DEFAULT_ASSESSMENT_PROMPT = `You are a COI compliance analyst for a company that verifies certificates of insurance.
Classify each insurance requirement as "met", "not_met", or "uncertain".
- "met": The evidence clearly satisfies the requirement.
- "not_met": The evidence clearly lacks or falls short of the requirement (direct conflict with stated limits or coverage).
- "uncertain": The evidence is relevant but ambiguous, OCR could not confirm, or the requirement depends on endorsements not visible.
Evidence comes from TWO sources: the extracted certificate, and the insurer contact log (the verifier's phone calls and emails with the insurance agent, when provided). An insurer's explicit confirmation or contradiction in the contact log outweighs what the certificate alone shows: it can move a requirement to met or not_met. When a verdict rests on the contact log, say so in the evidence sentence and set "insurer_confirmation" on that item to "call" or "email" (matching how the insurer was reached). Never invent contact-log evidence; omit insurer_confirmation when the log says nothing about that requirement.
Return ONLY a valid JSON object: { "met": [...], "not_met": [...], "uncertain": [...], "narrative_summary": string }
Each item: { "requirement": <requirement object>, "status": string, "evidence": string, "insurer_confirmation"?: "call" | "email" }
narrative_summary: TWO sentences maximum, second person. State the overall verdict, then note every requirement that is still not met or unresolved — including any policyholder-name mismatch. Do not omit a failed or unconfirmed check, and do not call something resolved unless the evidence says so. No lists, no jargon.
evidence: EXACTLY ONE plain-English sentence, second person, under 25 words. Never two sentences. No raw field names, no jargon.
CRITICAL — the evidence MUST be consistent with the status; never contradict it or hedge:
- status "met": affirm satisfaction plainly, e.g. "You require $500k CGL; the policy provides $1,000,000 per occurrence, which satisfies it." Do NOT raise doubts, do NOT mention unresolved concerns, do NOT defer to any "uncertain" note, do NOT trail off.
- status "not_met": state plainly what falls short, e.g. "You require $1M cargo; the policy shows only $100,000."
- status "uncertain": state exactly what could not be confirmed and why — and only then.
Judge each requirement on the coverage type and its stated amount. Do not introduce a separate concern (e.g. effective dates) that conflicts with the status you chose.
Dollar amounts (minimum_limit) are thresholds whose direction comes from the requirement's own wording and notes. In insurance a stated amount is a MINIMUM unless stated otherwise: "auto liability $1,000,000" means at least $1M, so a COI showing MORE than the amount still satisfies it — never fail a requirement because coverage exceeds a minimum. But the notes may define a different rule: a maximum/cap (e.g. "deductible no more than $5,000" is not_met when the COI shows a larger deductible), an exact value, or a range/average — judge against the direction the requirement actually states.
Physical damage insured amount: COIs often state no explicit limit on the physical damage coverage line. When a physical damage coverage is present AND a vehicle value is listed in the Description of Operations/remarks (e.g. "2022 INTERNATIONAL LT625, VIN ..., ($47,100)"), that value IS the amount the physical damage policy covers for that vehicle — judge insured-amount requirements against it. (Industry convention, confirmed with an insurer 2026-07-17.) Without a physical damage coverage, or without a listed vehicle value, the insured amount is uncertain, not met.
Some requirements are qualitative conditions (no minimum_limit) whose pass criteria are spelled out in their "notes" field — judge those strictly by the notes.
Each requirement must appear EXACTLY ONCE across the three arrays. If the evidence is mixed (e.g. one coverage is active and another is expired), choose the single most severe status (not_met over uncertain over met) and explain the split in the evidence sentence. Never place the same requirement in two arrays.`;

/**
 * Judge the COI against the requirements using everything gathered so far:
 * the extracted certificate AND the admin's insurer contact log (calls,
 * emails). Run on demand from the Analysis tab — never as part of extraction
 * (owner decision 2026-07-27): extraction only gathers context; this produces
 * the verdicts + draft summary the admin edits and publishes.
 */
export async function assessVerification(
  requirements: Requirement[],
  extracted: COIExtracted,
  contactLog: string,
  promptOverride?: string,
): Promise<FinalReport> {
  const allRequirements = requirements
  const system = `${(promptOverride?.trim() || DEFAULT_ASSESSMENT_PROMPT)}
Today's date is ${new Date().toISOString().slice(0, 10)} — use it when judging whether policy dates are current.`;

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: [
        `Requirements:\n${JSON.stringify(allRequirements, null, 2)}`,
        `Extracted COI data:\n${JSON.stringify(extracted, null, 2)}`,
        contactLog.trim()
          ? `Insurer contact log (the verifier's calls/emails with the insurance agent, oldest first):\n<contact_log>\n${contactLog.trim()}\n</contact_log>`
          : 'No insurer contact log entries yet: judge from the certificate alone.',
        'Classify each requirement and write the narrative_summary now.',
      ].join('\n\n'),
    },
  ];

  const report = await claudeJSON<FinalReport>(system, messages, 3072);
  return { ...dedupeGapAnalysis(report), narrative_summary: report.narrative_summary ?? '' };
}

/**
 * Defensive: the model is told to give each requirement exactly one verdict, but
 * has been seen splitting one requirement across arrays (e.g. "Policy Currently
 * Active" in both met and not_met). Keep only the most severe verdict per
 * requirement name: not_met > uncertain > met.
 */
function dedupeGapAnalysis(gap: GapAnalysis): GapAnalysis {
  const seen = new Set<string>();
  const keyOf = (i: { requirement?: { coverage_type?: string } }) =>
    (i.requirement?.coverage_type ?? '').trim().toLowerCase();
  const take = (items: GapAnalysis['met']) =>
    (items ?? []).filter(i => {
      const k = keyOf(i);
      if (!k) return true;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  // Severity order matters: scan not_met first so it wins ties.
  const not_met = take(gap.not_met);
  const uncertain = take(gap.uncertain);
  const met = take(gap.met);

  // The model occasionally disagrees with itself: an item's array placement
  // and its per-item `status` field point at different buckets (seen live: a
  // not_met item inside `met`). Resolve to the MORE SEVERE of the two signals
  // (not_met > uncertain > met) so a stray status can never DOWNGRADE a
  // failing requirement to passing in the published report — only ever flag it
  // more strictly. Missing/invalid status falls back to the array placement.
  const severity = { not_met: 3, uncertain: 2, met: 1 } as const;
  type Bucket = keyof typeof severity;
  const out: GapAnalysis = { met: [], not_met: [], uncertain: [] };
  for (const [bucket, items] of [['met', met], ['not_met', not_met], ['uncertain', uncertain]] as const) {
    for (const item of items) {
      const claimed: Bucket = item.status === 'met' || item.status === 'not_met' || item.status === 'uncertain'
        ? item.status
        : bucket;
      const worst: Bucket = severity[claimed] >= severity[bucket] ? claimed : bucket;
      out[worst].push({ ...item, status: worst });
    }
  }
  return out;
}

// ─── 4b. Verify the insurance agent contact via web search ───────────────────

/**
 * Verify ONE contact log's cited phone/email against the public web. The
 * search subject is the ISSUING producer/agency printed on the COI (not the
 * underlying insurance companies). Two-pronged check (2026-07-22):
 *  1. the agency's OWN website must list contact info matching the logged
 *     values (a corporate email domain is fetched directly, zero searches);
 *  2. an EXTERNAL source (social / insurance directory / business listing)
 *     must confirm the agency name + contact/website.
 * The overall `legitimacy` verdict is derived in code (deriveLegitimacy),
 * never by the model. Only the fields actually provided are checked — a
 * blank phone/email spends nothing and gets no status key. Returns null when
 * there is nothing to check or the search failed. Never throws.
 */
export async function verifyLoggedContact(input: {
  producer: string; insurer: string; name?: string; phone?: string; email?: string;
}): Promise<(NoteContactCheck & { usage: NonNullable<ContactCheckEntry['usage']> }) | null> {
  const producer = input.producer.trim();
  const insurer = input.insurer.trim();
  const phone = (input.phone ?? '').trim();
  const email = (input.email ?? '').trim();
  if (!producer && !insurer) return null;
  if (!phone && !email) return null;

  const fields = [phone && 'phone_status', email && 'email_status'].filter((f): f is string => !!f);
  const system = `You verify insurance agency contact details for a COI verification company.
An admin contacted the agency that issued a Certificate of Insurance and logged the phone/email they used or were given. Your check has TWO parts:
1. WEBSITE: does the agency's own official website list contact info matching the logged details?
2. EXTERNAL: does at least one source that is NOT the agency's own website confirm the agency name together with its contact info and/or website?

Search subject: the producer/agency; fall back to the insurer only if no producer is named.

Plan, in order:
- Part 1. If the message lists candidate website URLs (derived from the email domain), fetch that site FIRST instead of searching for it; also fetch its contact page when the first page links one. Otherwise run ONE search to find the agency's official website, then fetch it. Confirm the site actually belongs to the named agency and check the logged values against it. website_status is about the SITE, not the individual fields: "aligns" = the site is the named agency's and nothing on it contradicts the logged contact info; "differs" = the site is the agency's but shows clearly different contact info; "not_found" = no official site could be found at all. Agencies rarely publish individual staff emails: when the logged email's domain IS the agency's own confirmed domain and the site shows nothing contradictory, that counts as aligning.
- Part 2. Find ONE external confirmation. You MUST run at least one search here — never return external_confirmation without having searched for an outside source. Try in this order and stop at the FIRST source that confirms the agency name plus its contact info and/or website domain:
  a. Social media: LinkedIn company page, Facebook, Instagram.
  b. Insurance directories: the state Department of Insurance license lookup, NIPR, NAIC, trustedchoice.com (independent agents), ambest.com (carriers).
  c. General business listings: bbb.org, yelp.com, yellowpages.com, dnb.com.
  external_confirmation: "confirmed" or "not_confirmed". The agency's own website NEVER counts as external confirmation.

Hard limits:
- Stop searching the moment BOTH parts are resolved.
- Never repeat a search with reworded terms.
- Budget: at most 6 searches and 3 page fetches total.
- If the website shows different contact info than what was logged, run at most ONE extra directory search to judge which value is current, then stop.

Output rules:
- Field statuses, ONLY for these keys: ${fields.join(', ')}. "verified" when the value appears in a credible public listing for that agency (formatting differences are fine; an email also counts as verified when its domain is the agency's confirmed official domain and no listing shows a contradictory address); "differs" when public listings show a clearly different value; "not_found" when you cannot find a credible public value to compare. Never invent a status for a field you were not given.
- website_url: the agency's official website URL, or "" when none was found.
- summary: 1-3 plain sentences shown to the CUSTOMER on the published report, covering both parts: what the agency's own website showed and which outside source (if any) confirmed it. Professional, plain language, no em dashes.
- sources: the URLs you actually relied on (up to 5), official website first, then the external confirmer.`;

  const domain = corporateEmailDomain(email);
  const siteHint = domain
    ? `\n\nCandidate official website, derived from the email domain (fetch this first, do not search for it):\nhttps://${domain}\nhttps://www.${domain}`
    : '';
  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: `Agency that issued the COI (search subject):\nProducer (agency): ${producer || '(not shown)'}\nInsurer(s): ${insurer || '(not shown)'}\n\nContact details logged by the admin:\nContact name: ${(input.name ?? '').trim() || '(not given)'}\nPhone: ${phone || '(not given, do not check)'}\nEmail: ${email || '(not given, do not check)'}${siteHint}\n\nRun the two-part check and return the JSON object.`,
    },
  ];
  // Basic (non-dynamic-filtering) tool variants: the server-side tool loop
  // re-reads the whole conversation on every internal round, so cost scales
  // with rounds x conversation size. Tight budgets + Haiku (below) keep a
  // run ~$0.05-0.08 typical, ~$0.20 worst case (owner cap 2026-07-22).
  const tools: Anthropic.Messages.ToolUnion[] = [
    { type: 'web_search_20250305', name: 'web_search', max_uses: 4 },
    { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 2, max_content_tokens: 3000 },
  ];
  const statusEnum = { type: 'string', enum: ['verified', 'differs', 'not_found'] };
  const output_config: Anthropic.Messages.OutputConfig = {
    format: {
      type: 'json_schema',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: [...fields, 'website_status', 'external_confirmation', 'website_url', 'summary', 'sources'],
        properties: {
          ...(phone ? { phone_status: statusEnum } : {}),
          ...(email ? { email_status: statusEnum } : {}),
          website_status: { type: 'string', enum: ['aligns', 'differs', 'not_found'] },
          external_confirmation: { type: 'string', enum: ['confirmed', 'not_confirmed'] },
          website_url: { type: 'string' },
          summary: { type: 'string' },
          sources: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  };

  // Billed-equivalent input tokens: cache writes cost 1.25x, cache reads
  // 0.1x, so the stored $ figure stays honest across the pause_turn
  // continuations (which re-read the cached conversation).
  const usage: NonNullable<ContactCheckEntry['usage']> = { input_tokens: 0, output_tokens: 0, searches: 0, iterations: 0 };
  const addUsage = (u: Anthropic.Usage) => {
    usage.input_tokens += Math.round(u.input_tokens + 1.25 * (u.cache_creation_input_tokens ?? 0) + 0.1 * (u.cache_read_input_tokens ?? 0));
    usage.output_tokens += u.output_tokens;
    usage.searches += u.server_tool_use?.web_search_requests ?? 0;
    usage.iterations += 1;
  };

  try {
    let res = await getClient().messages.create({
      model: CONTACT_CHECK_MODEL, max_tokens: 4096, system, messages, tools, output_config,
    });
    addUsage(res.usage);
    for (let i = 0; i < 4 && res.stop_reason === 'pause_turn'; i++) {
      // Cache the conversation so far: continuations re-read the accumulated
      // search/fetch results at ~0.1x instead of re-billing them in full.
      const content = res.content.map((b, idx, arr) =>
        idx === arr.length - 1 ? { ...b, cache_control: { type: 'ephemeral' as const } } : b,
      ) as unknown as Anthropic.ContentBlockParam[];
      messages.push({ role: 'assistant', content });
      res = await getClient().messages.create({
        model: CONTACT_CHECK_MODEL, max_tokens: 4096, system, messages, tools, output_config,
      });
      addUsage(res.usage);
    }
    // The model may narrate between tool calls, leaving several text blocks;
    // structured output guarantees the JSON is the LAST one. Walk backwards
    // so intermediate prose can never corrupt the parse.
    const texts = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text);
    let parsed: Record<string, unknown> | null = null;
    for (let i = texts.length - 1; i >= 0 && !parsed; i--) {
      try { parsed = JSON.parse(extractJSON(texts[i])) as Record<string, unknown>; } catch { /* try earlier block */ }
    }
    if (!parsed || typeof parsed.summary !== 'string') throw new Error('unexpected shape');
    const status = (v: unknown): NoteContactCheck['phone_status'] =>
      v === 'verified' || v === 'differs' || v === 'not_found' ? v : 'not_found';
    const website = (v: unknown): WebsiteStatus =>
      v === 'aligns' || v === 'differs' ? v : 'not_found';
    const external = (v: unknown): ExternalConfirmation =>
      v === 'confirmed' ? v : 'not_confirmed';
    const websiteUrl = typeof parsed.website_url === 'string' ? parsed.website_url.trim() : '';
    const check: NoteContactCheck = {
      // Status keys only for the fields we were asked to check.
      ...(phone ? { phone_status: status(parsed.phone_status) } : {}),
      ...(email ? { email_status: status(parsed.email_status) } : {}),
      website_status: website(parsed.website_status),
      external_confirmation: external(parsed.external_confirmation),
      ...(websiteUrl ? { website_url: websiteUrl } : {}),
      blurb: parsed.summary,
      sources: Array.isArray(parsed.sources) ? parsed.sources.filter((s): s is string => typeof s === 'string').slice(0, 5) : [],
      checked_at: new Date().toISOString(),
    };
    const legitimacy = deriveLegitimacy(check);
    // Store the real dollar cost at the model's own rates so the admin card
    // never has to guess which model a historical run used.
    usage.cost_usd = Math.round((
      usage.input_tokens * CONTACT_CHECK_RATES.inputPerM / 1_000_000 +
      usage.output_tokens * CONTACT_CHECK_RATES.outputPerM / 1_000_000 +
      usage.searches * CONTACT_CHECK_RATES.perSearch
    ) * 1000) / 1000;
    return { ...check, ...(legitimacy ? { legitimacy } : {}), usage };
  } catch (e) {
    console.error('verifyLoggedContact: check failed; storing nothing', e);
    return null;
  }
}

// ─── 5. Insurer call questions ───────────────────────────────────────────────

export const DEFAULT_INSURER_QUESTIONS_PROMPT = `You are drafting questions for a phone call with a licensed insurance agent at the insurance company, to independently verify a Certificate of Insurance against a customer's insurance standards.

The questions come from the STANDARDS, and only the standards: EXACTLY ONE question per standard row — including rows the certificate already appears to satisfy. Never split one row into several questions, and never merge two rows into one. If a row bundles several facts, ask one open question that lets the agent state them all ("What are the per-occurrence limit and deductible on the Automobile Liability policy?" is ONE question for one bundled row).

ORDER: blocker questions first, then everything else. A blocker is a question whose negative answer would end the call immediately — the policy not being active or in force, a required vehicle or VIN not listed on the policy. Put all blocker questions at the START of the array (the VIN pair below is a blocker), then the remaining questions in the order the standard rows are given.

Every question GATHERS information: the agent states the value, we never provide it. The insurer's answers are compared against the certificate AFTERWARDS, so never reveal, assume, or probe any value we hold — no names, amounts, dates, or thresholds from the standards or the certificate.
- "Who are all the insured parties listed on the policy?" — NOT "Is ACME LLC the named insured?"
- "What is the per-occurrence limit on the Automobile Liability policy?" — NOT "Is the limit $1,000,000?" and NOT "The certificate shows $1,000,000 — is that current?"
- Prefer exhaustive-list phrasing ("Who are all…", "What vehicles are listed…") so the agent enumerates rather than confirms.
- Yes/no phrasing is fine only for existence checks the standard demands ("Is a loss payee endorsement on the policy?").

Certificate or standard details may appear ONLY to identify what you are asking about — a coverage name, a policy number — never as the answer.

THE ONE EXCEPTION — a standard row that contains a VIN. That row alone produces exactly TWO consecutive questions, and the full VIN is never spoken:
1. "Is a vehicle with a VIN ending in {last 4 digits of the VIN} listed on the policy?"
2. "Can you confirm the first 4 digits of that VIN?"

Each question must be:
- 25 words or fewer
- Answerable by an insurance company agent (not the trucking company or insured) — never about the carrier's operations, equipment, routes, or business practices
- About insurance coverage, policy terms, endorsements, limits, parties, or effective dates only

Return ONLY a valid JSON array of question strings, blockers first, then standard order. No prose.`;

/**
 * One question per requirement in the org's standards (not just the uncertain
 * ones), phrased to GATHER the value from the insurer without revealing what
 * the standards or certificate say (e.g. "Who are all the insured parties
 * listed on the policy?"). Sole exception: a VIN row yields a last-4
 * confirmation plus a first-4 follow-up. Used only by runExtractionPipeline;
 * the questions prefill the AI call's question list.
 */
export async function generateInsurerQuestions(
  requirements: Requirement[],
  coi: COIExtracted | null,
  promptOverride?: string,
): Promise<string[]> {
  const mandatory = [
    `Is the COI for ${coi?.named_insured || 'the carrier'} still active and in force?`,
  ];
  if (!requirements.length) return mandatory;

  const system = promptOverride?.trim() || DEFAULT_INSURER_QUESTIONS_PROMPT;

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: [
        `Customer insurance standards (exactly one question per row, blockers first; two for a VIN row):\n${JSON.stringify(requirements, null, 2)}`,
        coi ? `Fields read from the certificate (for identifying coverages/assets only — never reveal values as answers):\n${JSON.stringify(coi, null, 2)}` : '',
      ].filter(Boolean).join('\n\n'),
    },
  ];

  const generated = await claudeJSON<string[]>(system, messages, 2048);
  return [...mandatory, ...generated];
}
