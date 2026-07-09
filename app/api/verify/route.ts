import { NextRequest, NextResponse } from 'next/server';
import mammoth from 'mammoth';
import sharp from 'sharp';
import {
  extractTextFromFile,
  parseRequirements,
  extractCOIFields,
  analyzeGaps,
  generateAgentQuestions,
} from '@/lib/claude';
import { requireAuth } from '@/lib/auth';
import { rateLimitAllows, clientIp } from '@/lib/rate-limit';
import type { Requirement } from '@/lib/types';

export const maxDuration = 60;

// Downscale images before sending to Claude vision. Keeps the request payload
// small (large uploads intermittently corrupt over some networks) and matches
// Claude's ~1568px guidance, so extraction quality is unaffected. PDFs/others
// pass through unchanged (sharp can't rasterize them reliably).
async function prepForVision(buf: Buffer, mimeType: string): Promise<{ base64: string; mediaType: string }> {
  if (mimeType.startsWith('image/')) {
    try {
      const out = await sharp(buf)
        .rotate()
        .resize({ width: 1568, height: 1568, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();
      return { base64: out.toString('base64'), mediaType: 'image/jpeg' };
    } catch {
      return { base64: buf.toString('base64'), mediaType: mimeType };
    }
  }
  return { base64: buf.toString('base64'), mediaType: mimeType };
}

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
  // Each call fires several Claude requests; keep one demo visitor from
  // burning the Anthropic budget or its rate limits.
  if (!await rateLimitAllows(`demo_verify:${clientIp(req)}`, 10, 600)) {
    return NextResponse.json({ error: 'Too many verifications. Try again in a few minutes.' }, { status: 429 });
  }
  try {
    const formData = await req.formData();
    const reqFile = formData.get('requirements_file') as File | null;
    const reqJsonRaw = formData.get('requirements_json');
    const coiFile = formData.get('coi_file') as File | null;
    const rcsFile = formData.get('rcs_file') as File | null;

    if (!coiFile) return NextResponse.json({ error: 'coi_file is required' }, { status: 400 });
    if (!reqFile && !reqJsonRaw && !rcsFile) {
      return NextResponse.json({ error: 'requirements_file, requirements_json, or rcs_file is required' }, { status: 400 });
    }

    const coiOk = coiFile.type.startsWith('image/') || coiFile.type === 'application/pdf';
    if (!coiOk) {
      return NextResponse.json({ error: 'COI must be a JPG, PNG, or PDF' }, { status: 400 });
    }

    const coiBuffer = Buffer.from(await coiFile.arrayBuffer());

    // Pull raw text from an uploaded requirements / rate-con file
    // (image+pdf via vision, docx via mammoth, else utf-8).
    const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    async function fileToText(file: File): Promise<string> {
      const buf = Buffer.from(await file.arrayBuffer());
      if (file.type.startsWith('image/') || file.type === 'application/pdf') {
        const { base64, mediaType } = await prepForVision(buf, file.type);
        return extractTextFromFile(base64, mediaType);
      }
      if (file.type === DOCX) {
        const result = await mammoth.extractRawText({ buffer: buf });
        return result.value;
      }
      return buf.toString('utf-8');
    }

    // Gather requirement inputs from every source:
    //   • manual JSON rows (structured) + optional free-text notes
    //   • an uploaded "Additional Insurance Standards" file (free text)
    //   • the Rate Confirmation Sheet (free text — rate cons state/imply coverage requirements)
    let manualReqs: Requirement[] = [];
    const textSources: string[] = [];

    if (reqJsonRaw) {
      let payload: ManualRequirementsPayload;
      try {
        payload = JSON.parse(reqJsonRaw.toString());
      } catch {
        return NextResponse.json({ error: 'requirements_json must be valid JSON' }, { status: 400 });
      }
      manualReqs = (Array.isArray(payload.requirements) ? payload.requirements : [])
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
      if (extraNotes) textSources.push(extraNotes);
    } else if (reqFile) {
      textSources.push(await fileToText(reqFile));
    }

    // Rate confirmation sheet → fold its stated/implied requirements into the set
    if (rcsFile) {
      textSources.push(await fileToText(rcsFile));
    }

    // COI extraction + parse every free-text source, in parallel
    const coiImg = await prepForVision(coiBuffer, coiFile.type);
    const [coiExtracted, parsedChunks] = await Promise.all([
      extractCOIFields(coiImg.base64, coiImg.mediaType),
      Promise.all(textSources.map(t => (t.trim() ? parseRequirements(t) : Promise.resolve<Requirement[]>([])))),
    ]);
    const requirements: Requirement[] = [...manualReqs, ...parsedChunks.flat()];

    if (requirements.length === 0) {
      return NextResponse.json({ error: 'Provide at least one requirement via standards or the rate confirmation sheet.' }, { status: 400 });
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
