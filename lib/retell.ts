import Retell from 'retell-sdk';

const client = new Retell({ apiKey: process.env.RETELL_API_KEY! });

export async function initiateVerificationCall(params: {
  toNumber: string;
  verifierCompany: string;
  carrierCompany: string;
  insuranceCompany: string;
  policyHolder: string;
  questionsList: string;
  policyContext: string;
}): Promise<string> {
  const call = await client.call.createPhoneCall({
    from_number: process.env.RETELL_FROM_NUMBER!,
    to_number: params.toNumber,
    override_agent_id: process.env.RETELL_AGENT_ID!,
    retell_llm_dynamic_variables: {
      verifierCompany:  params.verifierCompany,
      carrierCompany:   params.carrierCompany,
      insuranceCompany: params.insuranceCompany,
      policyHolder:     params.policyHolder,
      questions_list:   params.questionsList,
      policyContext:    params.policyContext,
    },
  });
  return call.call_id;
}

export async function verifyWebhookSignature(rawBody: string, signature: string): Promise<boolean> {
  return Retell.verify(rawBody, process.env.RETELL_WEBHOOK_SECRET!, signature);
}
