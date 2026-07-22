export type CaseStatus =
  | 'pending_docs'
  | 'ocr_complete'
  | 'ready_for_call'
  | 'call_in_progress'
  | 'call_complete'
  | 'report_ready'
  | 'failed';

export interface Requirement {
  coverage_type: string;
  minimum_limit: string;
  notes: string | null;
  /**
   * 'limit' = numeric dollar threshold, shown as "Amount" in the UI (a minimum
   * unless the notes state otherwise — a cap, an exact value; the gap analysis
   * reads the direction from the notes); 'condition' = qualitative check with no
   * dollar amount (loss payee, name match, endorsements); 'variable' = a dollar
   * amount that changes per deal — minimum_limit holds a {token} placeholder in
   * storage (asked for at submission), or the plain human title while being
   * edited. Older rows predate the field: treat an empty minimum_limit as
   * 'condition'.
   */
  kind?: 'limit' | 'condition' | 'variable';
}

/** A minimum_limit that is exactly one {token} placeholder. */
export const VARIABLE_TOKEN_RE = /^\{([a-z0-9_]+)\}$/i;

/** Resolve a row's kind, tolerating rows saved before `kind` (or 'variable') existed. */
export function requirementKind(r: Pick<Requirement, 'minimum_limit' | 'kind'>): 'limit' | 'condition' | 'variable' {
  if (r.kind === 'condition') return 'condition';
  const limit = r.minimum_limit?.trim() ?? '';
  if (r.kind === 'variable' || VARIABLE_TOKEN_RE.test(limit)) return 'variable';
  return r.kind ?? (limit ? 'limit' : 'condition');
}

export interface COICoverage {
  type: string;
  insurer: string;
  policy_number: string;
  effective_date: string;
  expiration_date: string;
  each_occurrence_limit: string;
  aggregate_limit: string;
  conditions_and_exceptions: string;
  raw_notes: string;
  /** Optional: older extractions predate these fields. */
  additional_insured?: string;
  loss_payee?: string;
  /** Where this coverage row sits on the original document, for report
   *  highlighting. Percent-of-page coordinates. Older extractions lack it. */
  location?: FieldLocation | null;
}

/** A region on the uploaded certificate: 1-based page, box as percentages of
 *  the page's width/height — [x_left, y_top, x_right, y_bottom], 0-100. */
export interface FieldLocation {
  page: number;
  box: [number, number, number, number];
}

/** Keys of the non-coverage regions the extractor locates on the document. */
export type FieldLocationKey =
  | 'producer'
  | 'insured'
  | 'insurers'
  | 'certificate_holder'
  | 'additional_insured'
  | 'description_of_operations';

export interface COIExtracted {
  named_insured: string;
  named_insured_address: string;
  named_insured_phone: string;
  named_insured_email: string;
  usdot_number: string;
  mc_number: string;
  producer: string;
  insurance_company: string;
  insurance_company_address: string;
  insurance_company_phone: string;
  insurance_company_email: string;
  insurance_company_contact: string;
  named_insured_state: string;
  certificate_holder: string;
  additional_insured: string;
  additional_terms: string;
  /** Optional: older extractions predate these fields. */
  loss_payee?: string;
  /** Every other person/entity named anywhere on the cert (drivers, operators,
   *  DBAs, endorsement parties) with where each was found — the owner-operator hook. */
  other_named_parties?: string;
  coverages: COICoverage[];
  /** Where key regions sit on the original document, for report highlighting.
   *  Older extractions lack it; re-run extraction to backfill. */
  field_locations?: Partial<Record<FieldLocationKey, FieldLocation | null>>;
}

/**
 * One insurer contact note (verifications.call_notes entry). Notes are
 * append-only; the shape grew on 2026-07-16 when "call notes" became
 * "insurer contact notes". Legacy entries carry only { at, text, contact } —
 * render `text` as a plain-text summary. summary_html is sanitized at write
 * time (admin-only action, strict tag allowlist); summary_text is its
 * plain-text derivation for the PDF and fallbacks.
 */
export interface ContactNote {
  at: string;
  /** Free text: "email", "call", "text"... */
  contact_method?: string;
  summary_html?: string;
  summary_text?: string;
  transcript?: string;
  /** Legacy note body (pre contact-notes split). */
  text?: string;
  contact?: { name?: string; phone?: string; email?: string };
  /** Per-log web verification of THIS entry's cited phone/email. */
  contact_check?: NoteContactCheck;
  /** Set when the note was edited after the fact; `at` never changes. */
  edited_at?: string;
}

export type OnlineListingStatus = 'verified' | 'not_found' | 'differs';

/** Did the agency's own website's contact info align with what was logged? */
export type WebsiteStatus = 'aligns' | 'differs' | 'not_found';

/** Did a source OTHER than the agency's own site confirm name + contact + website? */
export type ExternalConfirmation = 'confirmed' | 'not_confirmed';

/**
 * Overall verdict, always derived in code (deriveLegitimacy), never set by
 * the model or edited directly: legit = website aligns AND an external source
 * confirms; mismatch = anything clearly contradicts; unverified = the rest.
 */
export type Legitimacy = 'legit' | 'unverified' | 'mismatch';

/**
 * Web verification of one contact log's cited phone/email, embedded in the
 * note itself (phones and emails can change between logs, so each entry gets
 * its own check). A status key is present ONLY when that field was actually
 * checked — a blank field is never searched and never gets a tag. Rides
 * inside call_notes, so publish gating covers it automatically. blurb is
 * customer-facing; the admin can edit statuses and blurb after a run.
 * The website/external/legitimacy fields arrived with the two-pronged check
 * (2026-07-22) — entries from earlier runs simply lack them.
 */
export interface NoteContactCheck {
  phone_status?: OnlineListingStatus;
  email_status?: OnlineListingStatus;
  website_status?: WebsiteStatus;
  external_confirmation?: ExternalConfirmation;
  legitimacy?: Legitimacy;
  /** The agency's official website when the check found one. */
  website_url?: string;
  blurb: string;
  sources: string[];
  checked_at: string;
  /** Set when an admin saves an edit over the run's result. */
  edited_at?: string;
}

/**
 * One run of the verification-level online contact check
 * (verifications.contact_checks, admin-only jsonb array, append-only history).
 * Same shape as a note's check plus the values that were actually checked.
 * Contact logs inherit tags by matching their cited phone/email against these
 * entries (newest run wins) — no web search runs at log time.
 */
export interface ContactCheckEntry extends NoteContactCheck {
  phone?: string;
  email?: string;
  /** Admin-only run telemetry; never copied into note snapshots. */
  usage?: { input_tokens: number; output_tokens: number; searches: number; iterations: number; cost_usd?: number };
}

export interface GapItem {
  requirement: Requirement;
  status: 'met' | 'not_met' | 'uncertain';
  evidence: string;
}

export interface GapAnalysis {
  met: GapItem[];
  not_met: GapItem[];
  uncertain: GapItem[];
}

export interface FinalReport {
  met: GapItem[];
  not_met: GapItem[];
  uncertain: GapItem[];
  narrative_summary: string;
}

export interface VerificationCase {
  id: string;
  created_at: string;
  updated_at: string;
  carrier_name: string | null;
  status: CaseStatus;
  requirements_doc_url: string | null;
  requirements_parsed: Requirement[] | null;
  coi_doc_url: string | null;
  coi_extracted: COIExtracted | null;
  gap_analysis: GapAnalysis | null;
  agent_questions: string[] | null;
  insurance_agent_phone: string | null;
  retell_call_id: string | null;
  call_transcript: string | null;
  call_extracted_answers: Record<string, string> | null;
  final_report: FinalReport | null;
}
