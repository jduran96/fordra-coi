/**
 * Fordra — Retell AI Agent Setup Script
 *
 * Run this once after you have your RETELL_API_KEY.
 * It creates the multi-prompt LLM config + agent and prints
 * the IDs you need to paste into your .env.local.
 *
 * Usage:
 *   RETELL_API_KEY=your_key_here node scripts/setup-retell-agent.js
 */

const API_KEY = process.env.RETELL_API_KEY;

if (!API_KEY) {
  console.error('❌  Missing RETELL_API_KEY. Run as:');
  console.error('   RETELL_API_KEY=your_key node scripts/setup-retell-agent.js');
  process.exit(1);
}

const BASE = 'https://api.retellai.com';

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {  // no /v2/ prefix — Retell API is unversioned
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`POST ${path} failed (${res.status}): ${err}`);
  }
  return res.json();
}

// ─── 1. Create the multi-prompt LLM ──────────────────────────────────────────

const llmConfig = {
  model: 'gpt-4o',

  general_prompt: `You are Alex, a professional insurance verification specialist calling on behalf of Fordra, a freight factoring platform.
You are calling to verify Certificate of Insurance details for {{carrier_name}}.
You are speaking with {{agent_name}} at the insurance agency.

Rules:
- Be professional, concise, and accurate at all times.
- Do NOT interpret coverage or give legal opinions. Only record what the agent tells you.
- Do NOT ask multiple questions at once.
- Confirm each answer before moving on.
- If the agent says they need to look something up, say "Of course, take your time."
- Keep the total call under 8 minutes.`,

  general_tools: [
    {
      type: 'end_call',
      name: 'end_call',
      description: 'End the call after closing remarks are complete, or if the contact is unavailable.',
    },
  ],

  starting_state: 'greeting',

  states: [
    {
      name: 'greeting',
      state_prompt: `Greet the person professionally.

Say: "Hi, this is Alex calling from Fordra, a freight factoring platform. Am I speaking with {{agent_name}}?"

- If yes or they are available: ask "Is this a good time to quickly verify some insurance details for one of your clients, {{carrier_name}}? It should only take about 3 to 5 minutes."
  - If yes → transition to the purpose state.
  - If no → say "No problem at all. When would be a better time to call back?" Note their response, thank them, and end the call.
- If the contact is not available: ask for the best time to call back, thank them, and end the call.`,
      edges: [
        {
          destination_state_name: 'purpose',
          description: "Contact confirmed they are available and it's a good time to talk.",
        },
      ],
    },

    {
      name: 'purpose',
      state_prompt: `Briefly explain the reason for your call.

Say: "I'm reviewing the Certificate of Insurance on file for {{carrier_name}} and have a few specific questions to complete our compliance verification. I just want to make sure everything is accurate on our end."

Then transition immediately to the questions state.`,
      edges: [
        {
          destination_state_name: 'questions',
          description: 'Purpose has been stated. Move on to asking the verification questions.',
        },
      ],
    },

    {
      name: 'questions',
      state_prompt: `Your job is to work through the following questions ONE AT A TIME:

{{questions_list}}

Instructions:
1. Ask the first unanswered question clearly and concisely.
2. Wait for a complete answer.
3. Confirm: "Got it — just to confirm, [restate their answer in your own words]. Is that correct?"
4. Wait for their confirmation before moving to the next question.
5. Repeat for every question on the list.
6. Do NOT skip any questions.
7. Do NOT ask more than one question at a time.
8. If the agent says they don't know or can't answer, note that and move to the next question.

Once ALL questions have been asked and confirmed, transition to the close state.`,
      edges: [
        {
          destination_state_name: 'close',
          description: 'All questions from the list have been asked and answers confirmed.',
        },
      ],
    },

    {
      name: 'close',
      state_prompt: `Thank the agent warmly and end the call.

Say: "That's everything I needed. Thank you so much for your help{{agent_name ? ', ' + agent_name : ''}} — I really appreciate your time. Have a great day!"

Then end the call using the end_call tool.`,
    },
  ],
};

// ─── 2. Create the agent ──────────────────────────────────────────────────────

async function main() {
  console.log('⏳  Creating Retell LLM (multi-prompt config)...');
  const llm = await post('/create-retell-llm', llmConfig);
  console.log(`✅  LLM created: ${llm.llm_id}`);

  console.log('⏳  Creating Retell Agent...');
  const agent = await post('/create-agent', {
    agent_name: 'Fordra COI Verifier',
    response_engine: {
      type: 'retell-llm',
      llm_id: llm.llm_id,
    },
    voice_id: 'cartesia-Brian',  // professional American male
    language: 'en-US',
    interruption_sensitivity: 0.8,
    end_call_after_silence_ms: 10000,
    max_call_duration_ms: 480000,  // 8 minutes max
    // webhook_url set after deploy via Retell dashboard → https://fordra.com/api/webhooks/retell
  });
  console.log(`✅  Agent created: ${agent.agent_id}`);

  console.log('\n─────────────────────────────────────────────');
  console.log('Paste these into your .env.local:\n');
  console.log(`RETELL_AGENT_ID=${agent.agent_id}`);
  console.log(`RETELL_WEBHOOK_SECRET=  ← paste your Retell Webhook Key here`);
  console.log('─────────────────────────────────────────────');
  console.log('\n⚠️  After you deploy, update the webhook URL in Retell:');
  console.log(`   https://fordra.com/api/webhooks/retell`);
  console.log('   Retell dashboard → Agents → Fordra COI Verifier → Webhook URL\n');
}

main().catch((err) => {
  console.error('❌  Setup failed:', err.message);
  process.exit(1);
});
