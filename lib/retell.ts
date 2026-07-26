import Retell from 'retell-sdk';

// Server-only: RETELL_API_KEY never reaches the client, and every caller of
// the dispatch/stop functions below sits behind requireAdmin().
const client = new Retell({ apiKey: process.env.RETELL_API_KEY! });

export async function verifyWebhookSignature(rawBody: string, signature: string): Promise<boolean> {
  return Retell.verify(rawBody, process.env.RETELL_WEBHOOK_SECRET!, signature);
}

/**
 * Admin AI verification call (voice spec v5). The variable map is the exact
 * admin-approved payload from buildDynamicVariables — nothing is added or
 * generated here. Callable only from admin server actions (requireAdmin runs
 * before every caller).
 */
export async function createAiVerificationCall(params: {
  toNumber: string;
  variables: Record<string, string>;
}): Promise<string> {
  const fromNumber = process.env.RETELL_FROM_NUMBER;
  const agentId = process.env.RETELL_AGENT_ID;
  if (!fromNumber || !agentId) {
    throw new Error('RETELL_FROM_NUMBER and RETELL_AGENT_ID must be set to dispatch calls.');
  }
  const call = await client.call.createPhoneCall({
    from_number: fromNumber,
    to_number: params.toNumber,
    override_agent_id: agentId,
    retell_llm_dynamic_variables: params.variables,
  });
  return call.call_id;
}

/** Current Retell state of one call (status, transcript, analysis, recording). */
export async function retrieveCall(callId: string) {
  return client.call.retrieve(callId);
}

/** Kill switch: ask Retell to end an ongoing call immediately. */
export async function stopCall(callId: string): Promise<void> {
  await client.call.stop(callId);
}

/** The agent id calls are dispatched to (recorded per call for the audit trail). */
export function configuredAgentId(): string {
  return process.env.RETELL_AGENT_ID ?? '';
}
