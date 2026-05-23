import { NextRequest, NextResponse } from 'next/server';
import { initiateVerificationCall } from '@/lib/retell';

function toE164(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return `+${digits}`;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      phone: string;
      agent_name?: string;
      carrier_name: string;
      questions: string[];
    };

    if (!body.phone)     return NextResponse.json({ error: 'phone is required' }, { status: 400 });
    if (!body.questions?.length) return NextResponse.json({ error: 'questions is required' }, { status: 400 });

    const questionsList = body.questions.map((q, i) => `${i + 1}. ${q}`).join('\n');

    const callId = await initiateVerificationCall({
      toNumber:     toE164(body.phone),
      carrierName:  body.carrier_name || 'the carrier',
      agentName:    body.agent_name   || 'the agent',
      questionsList,
    });

    return NextResponse.json({ call_id: callId });
  } catch (err) {
    console.error('[POST /api/call]', err);
    return NextResponse.json({ error: 'Failed to initiate call' }, { status: 500 });
  }
}
