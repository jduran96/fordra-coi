import { NextRequest, NextResponse } from 'next/server';
import { generateFinalReport } from '@/lib/claude';
import type { GapAnalysis } from '@/lib/types';

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const { gap_analysis, call_answers } = await req.json() as {
      gap_analysis: GapAnalysis;
      call_answers: Record<string, string>;
    };
    if (!gap_analysis) return NextResponse.json({ error: 'gap_analysis required' }, { status: 400 });

    const report = await generateFinalReport(gap_analysis, call_answers ?? {});
    return NextResponse.json(report);
  } catch (err) {
    console.error('[POST /api/final-report]', err);
    return NextResponse.json({ error: 'Failed to generate final report' }, { status: 500 });
  }
}
