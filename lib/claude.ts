import Anthropic from '@anthropic-ai/sdk';
import type {
  Requirement,
  COIExtracted,
  GapAnalysis,
  FinalReport,
} from './types';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
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
  const res = await client.messages.create({
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

// ─── 1. Extract plain text from an image (used for requirements docs) ────────

export async function extractTextFromImage(
  base64: string,
  mediaType: string,
): Promise<string> {
  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: base64 },
        },
        { type: 'text', text: 'Extract and return all text from this document exactly as written. No formatting, no summary — just the raw text content.' },
      ],
    },
  ];
  return callClaude('You are a document text extractor.', messages, 2048);
}

// ─── 2. Parse insurance requirements ─────────────────────────────────────────

export async function parseRequirements(docText: string): Promise<Requirement[]> {
  const system = `You are an insurance requirements analyst for a freight factoring company.
Extract all insurance coverage requirements from the provided document text.
Return ONLY a valid JSON array. No prose, no markdown fences.
Each element must have: coverage_type (string), minimum_limit (string), notes (string or null).
Only include requirements explicitly stated in the document. If a field is absent, use null.`;

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: `Document text:\n<document>\n${docText}\n</document>\n\nReturn the JSON array of requirements now.`,
    },
  ];

  return claudeJSON<Requirement[]>(system, messages, 2048);
}

// ─── 3. Extract COI fields via Vision ────────────────────────────────────────

export async function extractCOIFields(
  base64: string,
  mediaType: string,
): Promise<COIExtracted> {
  const system = `You are an expert at reading ACORD 25 Certificates of Insurance.
Extract every insurance field from the provided COI document image.
Return ONLY a valid JSON object — no prose, no markdown:
{
  "named_insured": string,
  "certificate_holder": string,
  "additional_insured": string,
  "coverages": [
    {
      "type": string,
      "insurer": string,
      "policy_number": string,
      "effective_date": string,
      "expiration_date": string,
      "each_occurrence_limit": string,
      "aggregate_limit": string,
      "raw_notes": string
    }
  ]
}
If a field is illegible or not present, use an empty string "".`;

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
            data: base64,
          },
        },
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
): Promise<GapAnalysis> {
  const system = `You are a COI compliance analyst for a trucking freight factoring company.
Classify each insurance requirement as "met", "not_met", or "uncertain".
- "met": The COI clearly satisfies the requirement with explicit evidence.
- "not_met": The COI clearly lacks or falls short of the requirement.
- "uncertain": The COI has relevant but ambiguous information, or may depend on endorsements not shown.
Return ONLY a valid JSON object: { "met": [...], "not_met": [...], "uncertain": [...] }
Each item: { "requirement": <requirement object>, "status": string, "evidence": string }
evidence must be a direct quote from the COI data or a specific explanation of what is missing.`;

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: `Requirements:\n${JSON.stringify(requirements, null, 2)}\n\nExtracted COI data:\n${JSON.stringify(extracted, null, 2)}\n\nClassify each requirement now.`,
    },
  ];

  return claudeJSON<GapAnalysis>(system, messages, 2048);
}

// ─── 5. Generate agent questions ──────────────────────────────────────────────

export async function generateAgentQuestions(gaps: GapAnalysis): Promise<string[]> {
  const system = `You are drafting questions for a phone call with a licensed insurance agent.
The goal is to resolve uncertain or missing coverage items on a Certificate of Insurance.
Each question must be:
- Specific and answerable with a yes/no or a single concrete value
- Reference the coverage type or policy by name if known
- Professional in tone
Return ONLY a valid JSON array of question strings. Maximum 8 questions. No prose.`;

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: `Uncertain items:\n${JSON.stringify(gaps.uncertain, null, 2)}\n\nNot met items:\n${JSON.stringify(gaps.not_met, null, 2)}\n\nGenerate specific questions to resolve these items.`,
    },
  ];

  return claudeJSON<string[]>(system, messages, 1024);
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
Write a concise narrative_summary (2–4 sentences) for the factoring company.
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
