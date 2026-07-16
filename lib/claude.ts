import Anthropic from '@anthropic-ai/sdk';
import { curlFetch } from './anthropic-fetch';
import { parseStandardLine } from './templates';
import type {
  Requirement,
  COIExtracted,
  GapAnalysis,
  FinalReport,
  AgentContactCheck,
  NoteContactCheck,
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
    if (Array.isArray(parsed) && parsed.length === lines.length) return parsed;
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

// ─── 4. Gap analysis ─────────────────────────────────────────────────────────

export async function analyzeGaps(
  requirements: Requirement[],
  extracted: COIExtracted,
  // The carrier this deal is for. Requirements like "insured party must be the
  // carrier" are unjudgeable without it (the model marks them not_met/uncertain
  // even on an exact name match). Optional: the frozen /demo caller omits it.
  carrierName?: string,
): Promise<GapAnalysis> {
  const allRequirements = requirements
  const carrierLine = carrierName?.trim()
    ? `\nThe carrier (trucking company) this verification is for is "${carrierName.trim()}". When a requirement references "the carrier", it means this company. Match names leniently: ignore case, punctuation, and entity-suffix formatting (LLC, Inc, Corp).`
    : ''
  const system = `You are a COI compliance analyst for a trucking freight factoring company.${carrierLine}
Today's date is ${new Date().toISOString().slice(0, 10)} — use it when judging whether policy dates are current.
Classify each insurance requirement as "met", "not_met", or "uncertain".
- "met": The COI clearly satisfies the requirement with explicit evidence.
- "not_met": The COI clearly lacks or falls short of the requirement (direct conflict with stated limits or coverage).
- "uncertain": The COI has relevant but ambiguous information, OCR could not confirm, or the requirement depends on endorsements not visible.
Return ONLY a valid JSON object: { "met": [...], "not_met": [...], "uncertain": [...] }
Each item: { "requirement": <requirement object>, "status": string, "evidence": string }
evidence: ONE plain-English sentence, second person, under 25 words. No raw field names, no jargon.
CRITICAL — the evidence MUST be consistent with the status; never contradict it or hedge:
- status "met": affirm satisfaction plainly, e.g. "You require $500k CGL; the policy provides $1,000,000 per occurrence, which satisfies it." Do NOT raise doubts, do NOT mention unresolved concerns, do NOT defer to any "uncertain" note, do NOT trail off.
- status "not_met": state plainly what falls short, e.g. "You require $1M cargo; the policy shows only $100,000."
- status "uncertain": state exactly what could not be confirmed and why — and only then.
Judge each requirement on the coverage type and its stated amount. Do not introduce a separate concern (e.g. effective dates) that conflicts with the status you chose.
Dollar amounts (minimum_limit) are thresholds whose direction comes from the requirement's own wording and notes. In insurance a stated amount is a MINIMUM unless stated otherwise: "auto liability $1,000,000" means at least $1M, so a COI showing MORE than the amount still satisfies it — never fail a requirement because coverage exceeds a minimum. But the notes may define a different rule: a maximum/cap (e.g. "deductible no more than $5,000" is not_met when the COI shows a larger deductible), an exact value, or a range/average — judge against the direction the requirement actually states.
Some requirements are qualitative conditions (no minimum_limit) whose pass criteria are spelled out in their "notes" field — judge those strictly by the notes.
Each requirement must appear EXACTLY ONCE across the three arrays. If the evidence is mixed (e.g. one coverage is active and another is expired), choose the single most severe status (not_met over uncertain over met) and explain the split in the evidence sentence. Never place the same requirement in two arrays.`;

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: `Requirements:\n${JSON.stringify(allRequirements, null, 2)}\n\nExtracted COI data:\n${JSON.stringify(extracted, null, 2)}\n\nClassify each requirement now.`,
    },
  ];

  const gap = await claudeJSON<GapAnalysis>(system, messages, 2048);
  return dedupeGapAnalysis(gap);
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
 * Check the producer/agent contact printed on the COI against the public web
 * (design partner: the agent listed on a COI isn't always legit). Uses the
 * server-side web_search tool; the model reports the phone/email it can match
 * to that agency online plus per-field verdicts. Returns null when the COI
 * names no agency/insurer to search for. Never throws — the extraction
 * pipeline must not fail because a web search did.
 */
export async function verifyInsurerContact(extracted: COIExtracted): Promise<AgentContactCheck | null> {
  const coi = {
    producer: (extracted.producer ?? '').trim(),
    insurer: (extracted.insurance_company ?? '').trim(),
    contact: (extracted.insurance_company_contact ?? '').trim(),
    phone: (extracted.insurance_company_phone ?? '').trim(),
    email: (extracted.insurance_company_email ?? '').trim(),
  };
  if (!coi.producer && !coi.insurer) return null;

  const system = `You verify insurance agent contact details for a COI verification company.
You are given the producer (agency), insurer, and contact details printed on a Certificate of Insurance. Use web search to find the agency's real, publicly listed phone number and email (official website, licensing directories, reputable business listings). Then compare what the COI says against what the web shows.
Rules:
- Search for the producer/agency first; fall back to the insurer if no producer is named.
- phone_match / email_match: "match" when the COI's value appears in a credible public listing for that agency (formatting differences are fine); "mismatch" when the public listing shows a clearly different value; "not_found" when you cannot find a credible public value to compare (or the COI omits that field).
- summary: 1-3 plain sentences an admin can act on, e.g. whether the printed contact looks legitimate and what could not be confirmed. No em dashes.
- sources: the URLs you actually relied on (up to 5).
After searching, return ONLY a valid JSON object, no prose, no markdown fences:
{ "phone": string, "email": string, "phone_match": "match"|"mismatch"|"not_found", "email_match": "match"|"mismatch"|"not_found", "summary": string, "sources": string[] }
phone/email: the best publicly listed values you found ("" if none).`;

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: `Contact details printed on the COI:\nProducer (agency): ${coi.producer || '(not shown)'}\nInsurer(s): ${coi.insurer || '(not shown)'}\nContact name: ${coi.contact || '(not shown)'}\nPhone: ${coi.phone || '(not shown)'}\nEmail: ${coi.email || '(not shown)'}\n\nVerify these against the web and return the JSON object.`,
    },
  ];
  const tools = [
    { type: 'web_search_20260209', name: 'web_search', max_uses: 5 },
  ] as unknown as Anthropic.Messages.ToolUnion[];

  try {
    let res = await getClient().messages.create({
      model: MODEL, max_tokens: 4096, system, messages, tools,
    });
    // Server-side tool loops can pause; resume by re-sending with the
    // assistant turn appended (bounded so we can never loop forever).
    for (let i = 0; i < 3 && res.stop_reason === 'pause_turn'; i++) {
      messages.push({ role: 'assistant', content: res.content });
      res = await getClient().messages.create({
        model: MODEL, max_tokens: 4096, system, messages, tools,
      });
    }
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('\n');
    const web = JSON.parse(extractJSON(text)) as AgentContactCheck['web'];
    if (!web || typeof web.summary !== 'string') throw new Error('unexpected shape');
    return {
      coi,
      web: {
        phone: typeof web.phone === 'string' ? web.phone : '',
        email: typeof web.email === 'string' ? web.email : '',
        phone_match: ['match', 'mismatch', 'not_found'].includes(web.phone_match) ? web.phone_match : 'not_found',
        email_match: ['match', 'mismatch', 'not_found'].includes(web.email_match) ? web.email_match : 'not_found',
        summary: web.summary,
        sources: Array.isArray(web.sources) ? web.sources.filter(s => typeof s === 'string').slice(0, 5) : [],
      },
      checked_at: new Date().toISOString(),
    };
  } catch (e) {
    console.error('verifyInsurerContact: check failed; storing nothing', e);
    return null;
  }
}

/**
 * Verify ONE contact log's cited phone/email against the public web. The
 * search subject is the ISSUING producer/agency printed on the COI (not the
 * underlying insurance companies): the question is "does this number/email
 * the admin was given actually belong to that agency's public listings".
 * Only the fields actually provided are checked — a blank phone/email spends
 * nothing and gets no status key. Returns null when there is nothing to
 * check or the search failed. Never throws.
 */
export async function verifyLoggedContact(input: {
  producer: string; insurer: string; name?: string; phone?: string; email?: string;
}): Promise<NoteContactCheck | null> {
  const producer = input.producer.trim();
  const insurer = input.insurer.trim();
  const phone = (input.phone ?? '').trim();
  const email = (input.email ?? '').trim();
  if (!producer && !insurer) return null;
  if (!phone && !email) return null;

  const fields = [phone && 'phone_status', email && 'email_status'].filter(Boolean);
  const system = `You verify insurance agency contact details for a COI verification company.
An admin contacted the agency that issued a Certificate of Insurance and logged the phone/email they used or were given. Use web search to check whether those details belong to that agency's real, publicly listed contact information (official website, licensing directories, reputable business listings).
Rules:
- Search for the producer/agency; fall back to the insurer only if no producer is named.
- For each provided field return a status: "verified" when the value appears in a credible public listing for that agency (formatting differences are fine); "differs" when public listings show a clearly different value; "not_found" when you cannot find a credible public value to compare.
- Return ONLY these status keys: ${fields.join(', ')}. Never invent a status for a field you were not given.
- summary: 1-3 plain sentences shown to the CUSTOMER on the published report, explaining what the search turned up. Professional, plain language, no em dashes.
- sources: the URLs you actually relied on (up to 5).
After searching, return ONLY a valid JSON object, no prose, no markdown fences:
{ ${fields.map(f => `"${f}": "verified"|"differs"|"not_found"`).join(', ')}${fields.length ? ', ' : ''}"summary": string, "sources": string[] }`;

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: `Agency that issued the COI (search subject):\nProducer (agency): ${producer || '(not shown)'}\nInsurer(s): ${insurer || '(not shown)'}\n\nContact details logged by the admin:\nContact name: ${(input.name ?? '').trim() || '(not given)'}\nPhone: ${phone || '(not given, do not check)'}\nEmail: ${email || '(not given, do not check)'}\n\nVerify the given details against the web and return the JSON object.`,
    },
  ];
  const tools = [
    { type: 'web_search_20260209', name: 'web_search', max_uses: 5 },
  ] as unknown as Anthropic.Messages.ToolUnion[];

  try {
    let res = await getClient().messages.create({
      model: MODEL, max_tokens: 4096, system, messages, tools,
    });
    for (let i = 0; i < 3 && res.stop_reason === 'pause_turn'; i++) {
      messages.push({ role: 'assistant', content: res.content });
      res = await getClient().messages.create({
        model: MODEL, max_tokens: 4096, system, messages, tools,
      });
    }
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('\n');
    const parsed = JSON.parse(extractJSON(text)) as Record<string, unknown>;
    if (!parsed || typeof parsed.summary !== 'string') throw new Error('unexpected shape');
    const status = (v: unknown): NoteContactCheck['phone_status'] =>
      v === 'verified' || v === 'differs' || v === 'not_found' ? v : 'not_found';
    return {
      // Status keys only for the fields we were asked to check.
      ...(phone ? { phone_status: status(parsed.phone_status) } : {}),
      ...(email ? { email_status: status(parsed.email_status) } : {}),
      blurb: parsed.summary,
      sources: Array.isArray(parsed.sources) ? parsed.sources.filter((s): s is string => typeof s === 'string').slice(0, 5) : [],
      checked_at: new Date().toISOString(),
    };
  } catch (e) {
    console.error('verifyLoggedContact: check failed; storing nothing', e);
    return null;
  }
}

// ─── 5. Generate agent questions ──────────────────────────────────────────────

export async function generateAgentQuestions(gaps: GapAnalysis, namedInsured?: string): Promise<string[]> {
  const mandatory = [
    `Is the COI for ${namedInsured || 'the carrier'} still active and in force?`,
    'Can you list all cargo types and situations covered under this policy?',
  ];

  if (!gaps.uncertain.length) return mandatory;

  const system = `You are drafting questions for a phone call with a licensed insurance agent at the insurance company.
The goal is to confirm coverage items that could not be determined from the Certificate of Insurance alone.
Each question must be:
- 20 words or fewer (fewer is better)
- Answerable by an insurance company agent (not the trucking company or insured) — do NOT ask about the carrier's operations, equipment, routes, or business practices
- About insurance coverage, policy terms, endorsements, limits, or effective dates only
- Specific and answerable with a yes/no or a single concrete value
- Reference the coverage type or policy by name if known
Return ONLY a valid JSON array of question strings. Maximum 6 questions. No prose.
Before returning, review your list: remove any duplicate or near-duplicate questions, remove any question an insurance agent cannot answer, then finalize at most 6 questions.`;

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: `Uncertain items that require agent confirmation:\n${JSON.stringify(gaps.uncertain, null, 2)}\n\nGenerate concise questions to resolve these items only.`,
    },
  ];

  const generated = await claudeJSON<string[]>(system, messages, 1024);
  return [...mandatory, ...generated];
}

/**
 * Admin-pipeline variant: one question per requirement in the org's standards
 * (not just the uncertain ones), each worded around what OCR already read off
 * the COI (e.g. "The certificate shows X as the named insured — are there
 * other insured parties?"). Used only by runExtractionPipeline; the frozen
 * /demo flow keeps generateAgentQuestions above.
 */
export async function generateInsurerQuestions(
  requirements: Requirement[],
  gaps: GapAnalysis | null,
  coi: COIExtracted | null,
): Promise<string[]> {
  const mandatory = [
    `Is the COI for ${coi?.named_insured || 'the carrier'} still active and in force?`,
  ];
  if (!requirements.length) return mandatory;

  const system = `You are drafting questions for a phone call with a licensed insurance agent at the insurance company, to verify a Certificate of Insurance against a customer's insurance requirements.

Draft EXACTLY ONE question per requirement, in the same order the requirements are given, covering every requirement — including ones the certificate appears to satisfy (those become confirmation questions).

Ground each question in what was already read from the certificate:
- If the certificate shows a relevant value, reference it ("The certificate shows $1,000,000 per occurrence for Auto Liability — is that the current limit?").
- If a value conflicts with the requirement, name what was seen and probe the discrepancy ("We see ACME LLC as the named insured — are there other insured parties on the policy?").
- If the certificate is silent on the requirement, ask directly whether the policy includes it.

Each question must be:
- 25 words or fewer
- Answerable by an insurance company agent (not the trucking company or insured) — never about the carrier's operations, equipment, routes, or business practices
- About insurance coverage, policy terms, endorsements, limits, parties, or effective dates only
- Specific: answerable with a yes/no or a single concrete value

Return ONLY a valid JSON array of question strings, one per requirement, same order. No prose.`;

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: [
        `Customer requirements (one question per row, in order):\n${JSON.stringify(requirements, null, 2)}`,
        gaps ? `Automated comparison of the certificate against these requirements (status + evidence per requirement):\n${JSON.stringify(gaps, null, 2)}` : '',
        coi ? `Fields read from the certificate:\n${JSON.stringify(coi, null, 2)}` : '',
      ].filter(Boolean).join('\n\n'),
    },
  ];

  const generated = await claudeJSON<string[]>(system, messages, 2048);
  return [...mandatory, ...generated];
}

// ─── 6. Parse call transcript ─────────────────────────────────────────────────

export async function parseTranscript(
  transcript: string,
  questions: string[],
): Promise<Record<string, string>> {
  const system = `You are parsing a phone call transcript between a COI verifier and an insurance agent.
Extract the agent's answer to each question asked during the call.
Return ONLY a valid JSON object where each key is the exact question text and the value is the agent's answer.
If a question was not addressed, set its value to "Not addressed in call."
If the agent was uncertain, capture their exact words.`;

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: `Questions asked:\n${JSON.stringify(questions, null, 2)}\n\nCall transcript:\n<transcript>\n${transcript}\n</transcript>\n\nExtract each answer now.`,
    },
  ];

  return claudeJSON<Record<string, string>>(system, messages, 2048);
}

// ─── 7. Generate final report ─────────────────────────────────────────────────

export async function generateFinalReport(
  gapAnalysis: GapAnalysis,
  callAnswers: Record<string, string>,
): Promise<FinalReport> {
  const system = `You are writing a final insurance compliance report for a freight factoring company.
You have a gap analysis from a COI review and answers obtained from a follow-up call with the insurance agent.
Update the status of previously uncertain or unmet items using the call answers.
Write a narrative_summary of 2–4 sentences (under ~55 words). State the overall verdict, then note EVERY requirement that is still not met or unresolved after the call — including any policyholder-name mismatch. Do not omit a failed or unconfirmed check, and do not call something resolved unless the evidence says so. No lists, no jargon.
Return ONLY valid JSON: { "met": [...], "not_met": [...], "uncertain": [...], "narrative_summary": string }
Each item has the same shape as the input gap items. Update the "evidence" field to reflect the call answers where applicable.`;

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: `Original gap analysis:\n${JSON.stringify(gapAnalysis, null, 2)}\n\nAnswers from insurance agent call:\n${JSON.stringify(callAnswers, null, 2)}\n\nProduce the final report.`,
    },
  ];

  return claudeJSON<FinalReport>(system, messages, 2048);
}
