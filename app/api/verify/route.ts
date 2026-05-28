import { NextRequest, NextResponse } from 'next/server';
import mammoth from 'mammoth';
import {
  extractTextFromFile,
  parseRequirements,
  extractCOIFields,
  analyzeGaps,
  generateAgentQuestions,
} from '@/lib/claude';
import { requireAuth } from '@/lib/auth';
import type { Requirement } from '@/lib/types';

export const maxDuration = 60;

interface ManualRequirementInput {
  coverage_type?: unknown;
  minimum_limit?: unknown;
  notes?: unknown;
}
interface ManualRequirementsPayload {
  requirements?: ManualRequirementInput[];
  additional_notes?: string | null;
}

function formatLimit(amount: number): string {
  return `$${amount.toLocaleString('en-US')}`;
}

export async function POST(req: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;
  try {
    const formData = await req.formData();
    const reqFile = formData.get('requirements_file') as File | null;
    const reqJsonRaw = formData.get('requirements_json');
    const coiFile = formData.get('coi_file') as File | null;

    if (!coiFile) return NextResponse.json({ error: 'coi_file is required' }, { status: 400 });
    if (!reqFile && !reqJsonRaw) {
      return NextResponse.json({ error: 'requirements_file or requirements_json is required' }, { status: 400 });
    }

    const coiOk = coiFile.type.startsWith('image/') || coiFile.type === 'application/pdf';
    if (!coiOk) {
      return NextResponse.json({ error: 'COI must be a JPG, PNG, or PDF' }, { status: 400 });
    }

    const coiBuffer = Buffer.from(await coiFile.arrayBuffer());

    // Resolve requirements: either from manual JSON input or from an uploaded file
    let requirements: Requirement[];
    let coiExtracted;

    if (reqJsonRaw) {
      let payload: ManualRequirementsPayload;
      try {
        payload = JSON.parse(reqJsonRaw.toString());
      } catch {
        return NextResponse.json({ error: 'requirements_json must be valid JSON' }, { status: 400 });
      }
      const manualReqs: Requirement[] = (Array.isArray(payload.requirements) ? payload.requirements : [])
        .map(r => {
          if (!r || typeof r.coverage_type !== 'string' || !r.coverage_type.trim()) return null;
          if (typeof r.minimum_limit !== 'number' || !Number.isFinite(r.minimum_limit) || r.minimum_limit <= 0) return null;
          const notes = typeof r.notes === 'string' && r.notes.trim() ? r.notes.trim() : null;
          return {
            coverage_type: r.coverage_type.trim(),
            minimum_limit: formatLimit(Math.trunc(r.minimum_limit)),
            notes,
          };
        })
        .filter((r): r is Requirement => r !== null);
      const extraNotes = (payload.additional_notes ?? '').trim();
      if (manualReqs.length === 0) {
        return NextResponse.json({ error: 'At least one requirement with coverage_type and a positive integer minimum_limit is required' }, { status: 400 });
      }
      // Run COI extraction (always) in parallel with parsing the free-text notes (if any)
      const [coi, parsedFromNotes] = await Promise.all([
        extractCOIFields(coiBuffer.toString('base64'), coiFile.type),
        extraNotes ? parseRequirements(extraNotes) : Promise.resolve<Requirement[]>([]),
      ]);
      coiExtracted = coi;
      requirements = [...manualReqs, ...parsedFromNotes];
    } else {
      const reqBuffer = Buffer.from(await reqFile!.arrayBuffer());
      const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      let reqText: string;
      if (reqFile!.type.startsWith('image/') || reqFile!.type === 'application/pdf') {
        reqText = await extractTextFromFile(reqBuffer.toString('base64'), reqFile!.type);
      } else if (reqFile!.type === DOCX) {
        const result = await mammoth.extractRawText({ buffer: reqBuffer });
        reqText = result.value;
      } else {
        reqText = reqBuffer.toString('utf-8');
      }
      const [parsedReqs, coi] = await Promise.all([
        parseRequirements(reqText),
        extractCOIFields(coiBuffer.toString('base64'), coiFile.type),
      ]);
      requirements = parsedReqs;
      coiExtracted = coi;
    }

    // Step 3: gap analysis
    const gapAnalysis = await analyzeGaps(requirements, coiExtracted);

    // Step 4: generate questions for uncertain/unmet items
    const agentQuestions = await generateAgentQuestions(gapAnalysis, coiExtracted.named_insured);

    // Return everything — nothing saved anywhere
    return NextResponse.json({
      requirements,
      coi_extracted: coiExtracted,
      gap_analysis: gapAnalysis,
      agent_questions: agentQuestions,
    });
  } catch (err) {
    console.error('[POST /api/verify]', err);
    return NextResponse.json({ error: 'Verification failed. Please try again.' }, { status: 500 });
  }
}
