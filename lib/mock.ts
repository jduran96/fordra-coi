// Mock data for the App and Admin paths. Shapes align with lib/types.ts so
// backend wiring later is mostly a data-source swap. All timestamps are
// hard-coded ISO strings (no Date.now()) to keep server/client renders
// deterministic and avoid hydration mismatches.
import type {
  CaseStatus,
  Requirement,
  COIExtracted,
  GapAnalysis,
  GapItem,
  FinalReport,
} from './types';

export type MockStatus = 'completed' | 'pending' | 'error';

export interface MockDoc {
  kind: 'requirements' | 'coi' | 'rcs';
  filename: string;
  uploaded_at: string;
  size_kb: number;
}

export interface MockUser {
  id: string;
  name: string;
  email: string;
  company: string;
  last_sign_in: string;
  verification_count: number;
}

export interface MockVerification {
  id: string;
  created_at: string;
  updated_at: string;
  carrier_name: string;
  requester: MockUser;
  source: 'web' | 'api';
  status: MockStatus;
  case_status: CaseStatus;
  eta: string | null;
  error_detail: string | null;
  docs: MockDoc[];
  requirements: Requirement[];
  agent_questions: string[] | null;
  insurance_contact: { name: string; phone: string; email: string; address: string } | null;
  coi_extracted: COIExtracted | null;
  gap_analysis: GapAnalysis | null;
  call_transcript: string | null;
  call_extracted_answers: Record<string, string> | null;
  final_report: FinalReport | null;
  cost_usd: number;
}

// ─── Users ─────────────────────────────────────────────────────────────────────
export const MOCK_USERS: MockUser[] = [
  { id: 'usr_01', name: 'Maya Chen',       email: 'maya@atlasfreight.com',    company: 'Atlas Freight Brokerage', last_sign_in: '2026-06-12T08:14:00Z', verification_count: 11 },
  { id: 'usr_02', name: 'Derek Okafor',    email: 'derek@atlasfreight.com',   company: 'Atlas Freight Brokerage', last_sign_in: '2026-06-11T19:42:00Z', verification_count: 7 },
  { id: 'usr_03', name: 'Sofia Ramírez',   email: 'sofia@atlasfreight.com',   company: 'Atlas Freight Brokerage', last_sign_in: '2026-06-10T15:05:00Z', verification_count: 4 },
  { id: 'usr_04', name: 'API service key', email: 'ops@atlasfreight.com',     company: 'Atlas Freight Brokerage', last_sign_in: '2026-06-12T06:00:00Z', verification_count: 9 },
  { id: 'usr_05', name: 'Jullian Alfonso', email: 'jullian@fordra.com',       company: 'Fordra (internal)',       last_sign_in: '2026-06-12T07:55:00Z', verification_count: 2 },
];

// ─── Shared building blocks ────────────────────────────────────────────────────
const STANDARD_REQUIREMENTS: Requirement[] = [
  { coverage_type: 'Auto Liability',          minimum_limit: '$1,000,000', notes: 'Must list broker as certificate holder' },
  { coverage_type: 'Motor Truck Cargo',       minimum_limit: '$100,000',   notes: 'Reefer breakdown coverage required' },
  { coverage_type: 'General Liability',       minimum_limit: '$1,000,000', notes: null },
  { coverage_type: "Workers' Compensation",   minimum_limit: '$500,000',   notes: 'Statutory where required' },
];

function makeCOI(named: string, producer: string, state: string, polPrefix: string): COIExtracted {
  return {
    named_insured: named,
    producer,
    insurance_company: producer,
    insurance_company_address: '1847 Commerce Blvd, Houston, TX',
    insurance_company_phone: '(727) 729-9594',
    insurance_company_email: 'service@' + producer.toLowerCase().replace(/[^a-z]/g, '') + '.com',
    named_insured_state: state,
    certificate_holder: 'Atlas Freight Brokerage LLC',
    additional_insured: 'Atlas Freight Brokerage LLC',
    coverages: [
      {
        type: 'Automobile Liability', insurer: producer, policy_number: `${polPrefix}-AL-88421`,
        effective_date: '2026-01-15', expiration_date: '2027-01-15',
        each_occurrence_limit: '$1,000,000', aggregate_limit: '',
        conditions_and_exceptions: '', raw_notes: 'Any auto. Certificate holder listed as additional insured.',
      },
      {
        type: 'Motor Truck Cargo', insurer: producer, policy_number: `${polPrefix}-MTC-30277`,
        effective_date: '2026-01-15', expiration_date: '2027-01-15',
        each_occurrence_limit: '$100,000', aggregate_limit: '',
        conditions_and_exceptions: '$2,500 deductible', raw_notes: '',
      },
      {
        type: 'Commercial General Liability', insurer: producer, policy_number: `${polPrefix}-GL-55190`,
        effective_date: '2026-01-15', expiration_date: '2027-01-15',
        each_occurrence_limit: '$1,000,000', aggregate_limit: '$2,000,000',
        conditions_and_exceptions: '', raw_notes: '',
      },
    ],
  };
}

function gapItems(coi: COIExtracted): { met: GapItem[]; not_met: GapItem[]; uncertain: GapItem[] } {
  return {
    met: [
      { requirement: STANDARD_REQUIREMENTS[0], status: 'met', evidence: `Auto liability policy ${coi.coverages[0].policy_number} shows a $1,000,000 combined single limit, meeting the requirement.` },
      { requirement: STANDARD_REQUIREMENTS[1], status: 'met', evidence: `Motor truck cargo policy carries a $100,000 limit per occurrence with a $2,500 deductible.` },
      { requirement: STANDARD_REQUIREMENTS[2], status: 'met', evidence: 'General liability shows $1,000,000 each occurrence and $2,000,000 aggregate.' },
    ],
    not_met: [],
    uncertain: [
      { requirement: STANDARD_REQUIREMENTS[3], status: 'uncertain', evidence: "Workers' compensation does not appear on the certificate; coverage could not be confirmed from documents alone." },
    ],
  };
}

const STANDARD_QUESTIONS = [
  'Is the policy currently in force with no lapses in the last 12 months?',
  'Does the motor truck cargo policy include reefer breakdown coverage?',
  "Does the carrier hold an active workers' compensation policy, and what is the limit?",
  'Are there any pending cancellations or non-renewal notices on any of these policies?',
];

const SAMPLE_TRANSCRIPT = `agent: Hi, this is the Fordra verification assistant calling on behalf of Atlas Freight Brokerage. I have a few questions about a certificate of insurance for one of your insureds. Do you have a moment?
user: Sure, go ahead.
agent: Is the auto liability policy currently in force with no lapses in the last twelve months?
user: Yes, that policy is active and has been continuously in force since January.
agent: Does the motor truck cargo policy include reefer breakdown coverage?
user: Yes, reefer breakdown is included up to the full cargo limit.
agent: Does the insured carry an active workers' compensation policy?
user: They do, with a five hundred thousand dollar employer liability limit.
agent: Are there any pending cancellations or non-renewal notices?
user: No, nothing pending on any of those policies.
agent: That covers everything. Thank you for your time.`;

const SAMPLE_ANSWERS: Record<string, string> = {
  'Is the policy currently in force with no lapses in the last 12 months?': 'Confirmed in force, no lapses since January.',
  'Does the motor truck cargo policy include reefer breakdown coverage?': 'Yes, included up to the full cargo limit.',
  "Does the carrier hold an active workers' compensation policy, and what is the limit?": 'Yes, $500,000 employer liability limit.',
  'Are there any pending cancellations or non-renewal notices on any of these policies?': 'None pending.',
};

function finalReportFor(coi: COIExtracted, carrier: string): FinalReport {
  const g = gapItems(coi);
  return {
    met: [
      ...g.met,
      { requirement: STANDARD_REQUIREMENTS[3], status: 'met', evidence: "Insurance agent confirmed an active workers' compensation policy with a $500,000 employer liability limit." },
    ],
    not_met: [],
    uncertain: [],
    narrative_summary: `${carrier} meets all coverage requirements. The insurer confirmed active policies with no lapses or pending cancellations.`,
  };
}

function docsFor(id: string, ts: string): MockDoc[] {
  return [
    { kind: 'requirements', filename: 'coverage-requirements.pdf', uploaded_at: ts, size_kb: 84 },
    { kind: 'coi',          filename: `${id.toLowerCase()}-acord25.pdf`, uploaded_at: ts, size_kb: 412 },
    { kind: 'rcs',          filename: `${id.toLowerCase()}-rate-confirmation.pdf`, uploaded_at: ts, size_kb: 198 },
  ];
}

const INSURANCE_CONTACT = {
  name: 'Meridian Insurance Group',
  phone: '(727) 729-9594',
  email: 'jullian@fordra.com',
  address: '1847 Commerce Blvd, Houston, TX',
};

// ─── Verification factory ──────────────────────────────────────────────────────
interface SeedRow {
  n: number;
  carrier: string;
  producer: string;
  state: string;
  status: MockStatus;
  created: string;
  requesterIdx: number;
  source: 'web' | 'api';
  eta?: string;
  error?: string;
}

function makeVerification(seed: SeedRow): MockVerification {
  const id = `VRF-${seed.n}`;
  const coi = makeCOI(seed.carrier, seed.producer, seed.state, `POL${seed.n}`);
  const completed = seed.status === 'completed';
  const errored = seed.status === 'error';
  const g = gapItems(coi);
  return {
    id,
    created_at: seed.created,
    updated_at: seed.created,
    carrier_name: seed.carrier,
    requester: MOCK_USERS[seed.requesterIdx],
    source: seed.source,
    status: seed.status,
    case_status: (completed ? 'report_ready' : errored ? 'pending_docs' : 'ready_for_call') as CaseStatus,
    eta: seed.eta ?? null,
    error_detail: seed.error ?? null,
    docs: errored ? docsFor(id, seed.created).slice(0, 2) : docsFor(id, seed.created),
    requirements: STANDARD_REQUIREMENTS,
    agent_questions: errored ? null : STANDARD_QUESTIONS,
    insurance_contact: errored ? null : INSURANCE_CONTACT,
    coi_extracted: errored ? null : coi,
    gap_analysis: errored ? null : g,
    call_transcript: completed ? SAMPLE_TRANSCRIPT : null,
    call_extracted_answers: completed ? SAMPLE_ANSWERS : null,
    final_report: completed ? finalReportFor(coi, seed.carrier) : null,
    cost_usd: completed ? 4.8 : errored ? 0.6 : 2.1,
  };
}

const SEEDS: SeedRow[] = [
  { n: 1068, carrier: 'Sunrise Trucking LLC',        producer: 'Meridian Insurance Group',  state: 'TX', status: 'pending',   created: '2026-06-12T07:48:00Z', requesterIdx: 0, source: 'web', eta: 'Today by 5:00 PM CT' },
  { n: 1067, carrier: 'Bluebonnet Carriers Inc',     producer: 'Lone Star Underwriters',    state: 'TX', status: 'pending',   created: '2026-06-12T06:21:00Z', requesterIdx: 3, source: 'api', eta: 'Today by 5:00 PM CT' },
  { n: 1066, carrier: 'Crestline Logistics Corp',    producer: 'Harbor National Insurance', state: 'CA', status: 'pending',   created: '2026-06-11T21:03:00Z', requesterIdx: 1, source: 'web', eta: 'Tomorrow by 12:00 PM CT' },
  { n: 1065, carrier: 'Red Cedar Haulers LLC',       producer: 'Meridian Insurance Group',  state: 'GA', status: 'error',     created: '2026-06-11T18:35:00Z', requesterIdx: 3, source: 'api', error: 'COI upload could not be read — the PDF appears to be password-protected. Ask the requester to re-submit an unlocked copy.' },
  { n: 1064, carrier: 'Prairie Wind Transport',      producer: 'Lone Star Underwriters',    state: 'OK', status: 'pending',   created: '2026-06-11T16:12:00Z', requesterIdx: 2, source: 'web', eta: 'Tomorrow by 12:00 PM CT' },
  { n: 1063, carrier: 'Ironline Freight Systems',    producer: 'Harbor National Insurance', state: 'IL', status: 'completed', created: '2026-06-11T14:27:00Z', requesterIdx: 0, source: 'web' },
  { n: 1062, carrier: 'Gulf Coast Carriers LLC',     producer: 'Meridian Insurance Group',  state: 'FL', status: 'completed', created: '2026-06-11T09:54:00Z', requesterIdx: 3, source: 'api' },
  { n: 1061, carrier: 'Summit Peak Logistics',       producer: 'Alpine Mutual Insurance',   state: 'CO', status: 'completed', created: '2026-06-10T20:41:00Z', requesterIdx: 1, source: 'web' },
  { n: 1060, carrier: 'Verde Valley Hauling Co',     producer: 'Harbor National Insurance', state: 'AZ', status: 'error',     created: '2026-06-10T17:08:00Z', requesterIdx: 3, source: 'api', error: 'Insurance producer phone number on the certificate is disconnected. Manual lookup required before the verification call can be placed.' },
  { n: 1059, carrier: 'Northstar Express Inc',       producer: 'Meridian Insurance Group',  state: 'MN', status: 'completed', created: '2026-06-10T13:22:00Z', requesterIdx: 0, source: 'web' },
  { n: 1058, carrier: 'Bayou Freight Lines',         producer: 'Lone Star Underwriters',    state: 'TX', status: 'completed', created: '2026-06-09T22:18:00Z', requesterIdx: 2, source: 'web' },
  { n: 1057, carrier: 'Copperfield Transport LLC',   producer: 'Alpine Mutual Insurance',   state: 'NV', status: 'completed', created: '2026-06-09T15:46:00Z', requesterIdx: 3, source: 'api' },
  { n: 1056, carrier: 'Eastgate Carriers Corp',      producer: 'Harbor National Insurance', state: 'PA', status: 'pending',   created: '2026-06-09T11:30:00Z', requesterIdx: 1, source: 'web', eta: 'In review — awaiting insurer callback' },
  { n: 1055, carrier: 'Silver Sage Trucking',        producer: 'Meridian Insurance Group',  state: 'NM', status: 'completed', created: '2026-06-08T19:55:00Z', requesterIdx: 0, source: 'web' },
  { n: 1054, carrier: 'Harbor Line Logistics',       producer: 'Lone Star Underwriters',    state: 'WA', status: 'completed', created: '2026-06-08T14:09:00Z', requesterIdx: 3, source: 'api' },
  { n: 1053, carrier: 'Twin Rivers Haulage',         producer: 'Alpine Mutual Insurance',   state: 'MO', status: 'completed', created: '2026-06-07T16:33:00Z', requesterIdx: 2, source: 'web' },
  { n: 1052, carrier: 'Pinnacle Road Freight',       producer: 'Harbor National Insurance', state: 'NC', status: 'error',     created: '2026-06-06T10:02:00Z', requesterIdx: 3, source: 'api', error: 'Rate confirmation sheet was missing from the API request payload. The verification cannot proceed without it.' },
  { n: 1051, carrier: 'Caprock Carriers LLC',        producer: 'Meridian Insurance Group',  state: 'TX', status: 'completed', created: '2026-06-05T18:47:00Z', requesterIdx: 0, source: 'web' },
  { n: 1050, carrier: 'Lakeshore Transit Co',        producer: 'Lone Star Underwriters',    state: 'MI', status: 'completed', created: '2026-06-04T13:11:00Z', requesterIdx: 1, source: 'web' },
  { n: 1049, carrier: 'Goldfield Express LLC',       producer: 'Alpine Mutual Insurance',   state: 'CA', status: 'completed', created: '2026-06-03T09:26:00Z', requesterIdx: 3, source: 'api' },
  { n: 1048, carrier: 'Cottonwood Freightways',      producer: 'Meridian Insurance Group',  state: 'KS', status: 'pending',   created: '2026-06-02T15:58:00Z', requesterIdx: 2, source: 'web', eta: 'In review — awaiting insurer callback' },
  { n: 1047, carrier: 'Blue Ridge Hauling Inc',      producer: 'Harbor National Insurance', state: 'VA', status: 'completed', created: '2026-06-01T11:40:00Z', requesterIdx: 0, source: 'web' },
  { n: 1046, carrier: 'Palmetto Carriers Group',     producer: 'Lone Star Underwriters',    state: 'SC', status: 'completed', created: '2026-05-29T17:19:00Z', requesterIdx: 3, source: 'api' },
  { n: 1045, carrier: 'Sierra Madre Transport',      producer: 'Alpine Mutual Insurance',   state: 'CA', status: 'error',     created: '2026-05-28T08:50:00Z', requesterIdx: 1, source: 'web', error: 'OCR confidence on the COI was below threshold (scan quality too low). The document needs to be re-scanned at higher resolution.' },
  { n: 1044, carrier: 'Heartland Haul Lines',        producer: 'Meridian Insurance Group',  state: 'IA', status: 'completed', created: '2026-05-27T14:05:00Z', requesterIdx: 2, source: 'web' },
];

export const MOCK_VERIFICATIONS: MockVerification[] = SEEDS.map(makeVerification);

// The design partner's own submissions (App path → Status page).
export const MY_VERIFICATIONS: MockVerification[] = MOCK_VERIFICATIONS
  .filter(v => v.requester.id === 'usr_01' || v.requester.id === 'usr_04')
  .slice(0, 10);

// ─── Activity feed (App path → Home) ───────────────────────────────────────────
export const MOCK_ACTIVITY: { ts: string; text: string; verificationId: string; status: MockStatus }[] = [
  { ts: '2026-06-12T07:48:00Z', text: 'Verification submitted for Sunrise Trucking LLC',                        verificationId: 'VRF-1068', status: 'pending' },
  { ts: '2026-06-12T06:21:00Z', text: 'API verification request received for Bluebonnet Carriers Inc',          verificationId: 'VRF-1067', status: 'pending' },
  { ts: '2026-06-11T15:02:00Z', text: 'Final report ready for Ironline Freight Systems',                        verificationId: 'VRF-1063', status: 'completed' },
  { ts: '2026-06-11T10:31:00Z', text: 'Final report ready for Gulf Coast Carriers LLC',                         verificationId: 'VRF-1062', status: 'completed' },
  { ts: '2026-06-10T17:08:00Z', text: 'Verification failed for Verde Valley Hauling Co — producer unreachable', verificationId: 'VRF-1060', status: 'error' },
  { ts: '2026-06-10T14:00:00Z', text: 'Final report ready for Northstar Express Inc',                           verificationId: 'VRF-1059', status: 'completed' },
];

// ─── Derived stats ─────────────────────────────────────────────────────────────
// "Now" is pinned to the session's mock clock so derived stats stay stable.
const MOCK_NOW = new Date('2026-06-12T09:00:00Z').getTime();
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function deriveAdminStats(rows: MockVerification[]) {
  const pending = rows.filter(v => v.status === 'pending').length;
  const errors = rows.filter(v => v.status === 'error').length;
  const completed = rows.filter(v => v.status === 'completed').length;
  const lastWeek = rows.filter(v => MOCK_NOW - new Date(v.created_at).getTime() < WEEK_MS).length;
  const completionRate = rows.length ? Math.round((completed / rows.length) * 100) : 0;
  const api = rows.filter(v => v.source === 'api').length;
  const web = rows.length - api;
  return {
    pending,
    errors,
    completed,
    lastWeek,
    completionRate,
    avgTurnaroundHrs: 6.4,
    apiCount: api,
    webCount: web,
  };
}

export function deriveAppStats(rows: MockVerification[]) {
  const total = rows.length;
  const inProgress = rows.filter(v => v.status === 'pending').length;
  const completed = rows.filter(v => v.status === 'completed').length;
  const spend = rows.reduce((sum, v) => sum + v.cost_usd, 0);
  return {
    total,
    inProgress,
    completed,
    spend: `$${spend.toFixed(2)}`,
    avgTurnaroundHrs: 6.4,
  };
}

// ─── Display helpers ───────────────────────────────────────────────────────────
export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
    timeZone: 'America/Chicago',
  });
}

export const STATUS_LABELS: Record<MockStatus, string> = {
  completed: 'Completed',
  pending: 'Pending',
  error: 'Error',
};
