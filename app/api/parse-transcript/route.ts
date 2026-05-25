import { NextRequest, NextResponse } from 'next/server';
import { parseTranscript } from '@/lib/claude';

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const { transcript, questions } = await req.json() as {
      transcript: string;
      questions: string[];
    };
    if (!transcript) return NextResponse.json({ error: 'transcript required' }, { status: 400 });
    if (!questions?.length) return NextResponse.json({ answers: {} });

    const answers = await parseTranscript(transcript, questions);
    return NextResponse.json({ answers });
  } catch (err) {
    console.error('[POST /api/parse-transcript]', err);
    return NextResponse.json({ error: 'Failed to parse transcript' }, { status: 500 });
  }
}
