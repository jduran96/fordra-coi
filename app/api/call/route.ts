import { NextRequest, NextResponse } from 'next/server';
import { initiateVerificationCall } from '@/lib/retell';
import { requireAuth } from '@/lib/auth';

function toE164(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return `+${digits}`;
}

export async function POST(req: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;
  try {
    const body = await req.json() as {
      phone: string;
      verifier_company: string;
      carrier_company: string;
      insurance_company: string;
      policy_holder: string;
      questions: string[];
      policy_context: string;
    };

    if (!body.phone)              return NextResponse.json({ error: 'phone is required' }, { status: 400 });
    if (!body.questions?.length)  return NextResponse.json({ error: 'questions is required' }, { status: 400 });

    const questionsList = body.questions.map((q, i) => `${i + 1}. ${q}`).join('\n');

    const callId = await initiateVerificationCall({
      toNumber:         toE164(body.phone),
      verifierCompany:  body.verifier_company  || 'the verifier',
      carrierCompany:   body.carrier_company   || 'the carrier',
      insuranceCompany: body.insurance_company || 'the insurance company',
      policyHolder:     body.policy_holder     || 'the named insured',
      questionsList,
      policyContext:    body.policy_context    || '',
    });

    return NextResponse.json({ call_id: callId });
  } catch (err) {
    console.error('[POST /api/call]', err);
    return NextResponse.json({ error: 'Failed to initiate call' }, { status: 500 });
  }
}
