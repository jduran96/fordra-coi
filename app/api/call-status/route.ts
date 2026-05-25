import { NextRequest, NextResponse } from 'next/server';
import Retell from 'retell-sdk';

const client = new Retell({ apiKey: process.env.RETELL_API_KEY! });

export async function GET(req: NextRequest) {
  const callId = req.nextUrl.searchParams.get('callId');
  if (!callId) return NextResponse.json({ error: 'callId required' }, { status: 400 });

  try {
    const call = await client.call.retrieve(callId);
    return NextResponse.json({
      status:     call.call_status,
      transcript: (call as unknown as Record<string, unknown>).transcript ?? null,
    });
  } catch (err) {
    console.error('[GET /api/call-status]', err);
    return NextResponse.json({ error: 'Failed to get call status' }, { status: 500 });
  }
}
