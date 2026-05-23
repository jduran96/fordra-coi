export type CaseStatus =
  | 'pending_docs'
  | 'ocr_complete'
  | 'ready_for_call'
  | 'call_in_progress'
  | 'call_complete'
  | 'report_ready';

export interface Requirement {
  coverage_type: string;
  minimum_limit: string;
  notes: string | null;
}

export interface COICoverage {
  type: string;
  insurer: string;
  policy_number: string;
  effective_date: string;
  expiration_date: string;
  each_occurrence_limit: string;
  aggregate_limit: string;
  raw_notes: string;
}

export interface COIExtracted {
  named_insured: string;
  certificate_holder: string;
  additional_insured: string;
  coverages: COICoverage[];
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
