import Retell from 'retell-sdk';

const client = new Retell({ apiKey: process.env.RETELL_API_KEY! });

export async function initiateVerificationCall(params: {
  toNumber: string;
  carrierName: string;
  agentName: string;
  questionsList: string; // pre-formatted numbered list
}): Promise<string> {
  const call = await client.call.createPhoneCall({
    from_number: process.env.RETELL_FROM_NUMBER!,
    to_number: params.toNumber,
    override_agent_id: process.env.RETELL_AGENT_ID!,
    retell_llm_dynamic_variables: {
      carrier_name:   params.carrierName,
      agent_name:     params.agentName || 'the agent',
      questions_list: params.questionsList,
    },
  });
  return call.call_id;
}

export async function verifyWebhookSignature(rawBody: string, signature: string): Promise<boolean> {
  return Retell.verify(rawBody, process.env.RETELL_WEBHOOK_SECRET!, signature);
}
