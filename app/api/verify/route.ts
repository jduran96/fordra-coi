import { NextRequest, NextResponse } from 'next/server';
import {
  extractTextFromFile,
  parseRequirements,
  extractCOIFields,
  analyzeGaps,
  generateAgentQuestions,
} from '@/lib/claude';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const reqFile = formData.get('requirements_file') as File | null;
    const coiFile = formData.get('coi_file') as File | null;

    if (!reqFile) return NextResponse.json({ error: 'requirements_file is required' }, { status: 400 });
    if (!coiFile) return NextResponse.json({ error: 'coi_file is required' }, { status: 400 });

    const coiOk = coiFile.type.startsWith('image/') || coiFile.type === 'application/pdf';
    if (!coiOk) {
      return NextResponse.json({ error: 'COI must be a JPG, PNG, or PDF' }, { status: 400 });
    }

    // Read both files into memory — no disk, no blob, no DB
    const [reqBuffer, coiBuffer] = await Promise.all([
      reqFile.arrayBuffer().then(Buffer.from),
      coiFile.arrayBuffer().then(Buffer.from),
    ]);

    // Step 1: extract requirements text
    let reqText: string;
    if (reqFile.type.startsWith('image/') || reqFile.type === 'application/pdf') {
      reqText = await extractTextFromFile(reqBuffer.toString('base64'), reqFile.type);
    } else {
      reqText = reqBuffer.toString('utf-8');
    }

    // Step 2: parse requirements + extract COI fields in parallel
    const [requirements, coiExtracted] = await Promise.all([
      parseRequirements(reqText),
      extractCOIFields(coiBuffer.toString('base64'), coiFile.type),
    ]);

    // Step 3: gap analysis
    const gapAnalysis = await analyzeGaps(requirements, coiExtracted);

    // Step 4: generate questions for uncertain/unmet items
    const agentQuestions = await generateAgentQuestions(gapAnalysis);

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
