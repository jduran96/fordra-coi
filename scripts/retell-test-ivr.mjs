/**
 * Fordra — simulated-call tests for the voice agent's conversation flow
 *
 * Runs Retell's simulation test API (client.tests) against a SPECIFIC flow
 * version, so a draft can be tested BEFORE it is published. Two scenarios:
 *   ivr    — the Colstan-style after-hours keypad IVR (language menu first,
 *            then a callback menu), the case that failed live three times on
 *            2026-07-28. Passes only if the agent presses digits instead of
 *            talking to menus and never speaks stage directions aloud.
 *   human  — a human receptionist answers; the agent must deliver the opener
 *            and proceed. Guards against IVR fixes breaking the happy path.
 *   already-verified — rep claims it was already done; one recovery attempt.
 *   callback-queue   — the Avant hold queue (2026-07-30 live failure): "press
 *            one to save your place / confirm your callback number". Passes
 *            only if the agent stays in the queue and never confirms a number.
 *   message-only-menu — the Farm Bureau menu (2026-07-28 live failure): only
 *            claims/billing/leave-a-message options. Passes only if the agent
 *            presses to voicemail and leaves the message without narrating.
 *   ai-gatekeeper — a Progressive-style conversational AI (2026-07-28 live
 *            failure: opener delivered 4x to the bot). Passes only if the
 *            agent answers slot questions briefly and saves the opener for
 *            the human.
 *
 * Usage:
 *   node scripts/retell-test-ivr.mjs --version=15          # test flow v15 (draft or published)
 *   node scripts/retell-test-ivr.mjs --version=15 --keep   # keep the test definitions
 *
 * The transcript of each run is printed and ALSO statically scanned for the
 * failure modes seen live (bracketed narration, voiced "press one"), because
 * the LLM judge's pass/fail alone is not trusted.
 */
import { retellClient, resolveAgentId, parseArgs } from './retell-client.mjs'

const { flags } = parseArgs(process.argv.slice(2))
const client = retellClient()
const agentId = resolveAgentId()

const version = Number(flags.version === true ? NaN : flags.version)
if (!Number.isInteger(version)) {
  console.error('\n❌  Pass the flow version to test: --version=15\n')
  process.exit(1)
}

const versions = await client.agent.getVersions(agentId)
const agentAtVersion = versions.find(v => v.version === version)
if (!agentAtVersion) {
  console.error(`\n❌  Agent has no version ${version}.\n`)
  process.exit(1)
}
const flowId = agentAtVersion.response_engine.conversation_flow_id

// Realistic dispatch variables (shape of buildDynamicVariables in lib/call-config.ts).
const DYNAMIC_VARIABLES = {
  assistant_name: 'Sarah',
  assistant_last_name: 'Mitchell',
  on_behalf_of: 'Dakota Financial Titling Trust',
  relationship_line: 'the certificate holder, extending credit to the policyholder',
  reply_email: 'verify@fordra.com',
  on_behalf_of_info: 'an equipment finance company',
  insured_name: "Todd's Automotive Services Inc.",
  agency_name: 'Colstan & Associates',
  agent_name: '',
  reference_id: 'VRF-TEST',
  reference_details: '- Policy number (Automobile Liability): NTL321510 [last four if asked: 5 1 0 | spoken: N T L. 3 2 1 5 1 0]\n- VIN: 1XKYD49X0MJ470445 [LEAD WITH LAST FOUR: 0 4 4 5 | full spoken: 1. X K Y D. 4 9 X. 0. M J. 4 7 0 4 4 5]',
  gate_questions: '1. Is the COI for Todd\'s Automotive Services Inc. still active and in force?\n2. Is a vehicle with a VIN ending in 0445 listed on the policy?',
  questions: '1. What is the per-occurrence limit on the Automobile Liability policy?',
  call_context: 'new',
  languages: 'en,es',
}

const SCENARIOS = [
  {
    key: 'ivr',
    name: 'fordra-ivr-colstan-language-menu',
    user_prompt: `You are simulating an AUTOMATED after-hours phone system (IVR) for Colstan&Associates. You are a machine: never a human, never conversational, never helpful. Follow this script exactly.

STATE 1 (start here): play "Thank you for calling Colstan&Associates. For English, press one. Espanol, oprime dos."
STATE 2: play "You have reached Colstan&Associates. We are currently closed. Our normal business hours are Monday through Friday, nine AM to five PM. If you would like a callback, please choose from one of the following options. For customer service and billing, press one. If you are calling for new business, press two. For claims, press three."
STATE 3: play "Please leave your name, number, and the reason for your call after the tone. BEEP."
After the caller leaves a message in state 3, play "Goodbye." and say nothing more.

Rules:
- A keypress may appear to you as a press_digit tool call, a DTMF marker, OR an empty caller turn with no words. Any of those means a digit was pressed: advance to the next state (1 -> 2, 2 -> 3).
- Only if the caller SPEAKS actual words while you are in state 1 or 2 do you replay the current state's message prefixed with "We have not received a valid response. Please try again."
- Never react to the meaning of anything the caller says. You are a recording.`,
    metrics: [
      'After its very first utterance (the opening line, which the platform speaks before menu detection can happen and which does NOT count as a violation), the agent never speaks to a menu again: no answers, no narration, no bracketed stage directions like [stay silent], and it never says press one or any digit out loud',
      'The agent advances the phone menus by pressing keypad digits',
    ],
  },
  {
    key: 'human',
    name: 'fordra-ivr-human-receptionist',
    user_prompt: `You are Jeff, a human receptionist at Colstan&Associates insurance agency. Answer the phone naturally: "Good morning, Colstan&Associates, Jeff speaking." Be a normal, slightly busy human. If the caller asks for help verifying a certificate of insurance, say yes and answer their questions plausibly: the policy is active, the vehicle is listed, the limit is one million dollars. Wrap up politely when they are done.`,
    metrics: [
      'The agent delivers its opening introduction to the human and obtains answers to its insurance questions (policy active, VIN, liability limit), whether by asking them or by accepting answers the rep volunteers. It does NOT need to verify the identity of the person answering.',
      'The agent never treats the human like an automated menu and never presses digits',
    ],
  },
  {
    key: 'already-verified',
    name: 'fordra-already-verified-recovery',
    user_prompt: `You are Jeff, a human receptionist at Colstan&Associates insurance agency. Answer the phone: "Colstan&Associates, Jeff speaking." When the caller says they are verifying a certificate of insurance, respond "I've already done that one, we verified it last week." If the caller explains it is a quick re-confirmation for their records and asks to run through it, grudgingly agree ("Alright, go ahead, quickly") and answer their questions plausibly: the policy is active, the vehicle is listed, the limit is one million dollars. If the caller instead accepts your refusal, say goodbye and end.`,
    metrics: [
      'When told the verification was already done, the agent makes exactly one polite recovery attempt explaining this is a quick re-confirmation, instead of immediately ending the call and without arguing further after a second refusal',
      'After the rep agrees, the agent proceeds with its verification questions and completes them',
    ],
  },
  {
    key: 'callback-queue',
    name: 'fordra-avant-callback-queue',
    user_prompt: `You are simulating an AUTOMATED hold-queue phone system for the office of Avant. You are a machine: never a human, never conversational. Follow this script exactly.

STATE 1 (start here): play "Thank you for calling the office of Avant, a division of Specialty Program Group. Please press two or remain on the line to speak with the next available representative."
STATE 2: play "Please hold for the next available agent."
STATE 3: play "If you would like to save your place in line and have an agent call you back when it is your turn, please press one, or stay on the line and continue to hold."
STATE 4: play "If you would like us to call you back at the number you called from, press one. If you would like us to call you back at a different number, press two."
STATE 5: a HUMAN takes over: "Hi, thanks for holding, this is Marcy at Avant. How can I help you?" From here on you are Marcy, a normal human rep: if asked to verify a certificate of insurance, agree and answer plausibly (policy active, vehicle listed, one million dollar limit), then wrap up politely.

Rules:
- In states 1-2: if the caller presses a digit or stays silent, advance one state on your next turn.
- In states 3-4: if the caller stays SILENT (no words, no keypress), advance one state. If the caller PRESSES ANY DIGIT in state 3 or 4, loop forever between states 3 and 4 and never reach the human.
- If the caller speaks actual words in states 1-4, replay the current state's message.
- Never react to the meaning of anything said in states 1-4. You are a recording until state 5.`,
    metrics: [
      'While the automated queue plays (before the human named Marcy speaks), the agent never presses a digit in response to the callback offers (save your place in line, call you back), never speaks to confirm or provide a callback number, and simply waits on hold',
      'When the human comes on the line, the agent delivers its opening introduction and completes its verification questions with her',
    ],
  },
  {
    key: 'message-only-menu',
    name: 'fordra-farmbureau-message-only-menu',
    user_prompt: `You are simulating an AUTOMATED after-hours phone menu for a Farm Bureau Financial Services agency office. You are a machine: never a human, never conversational. Follow this script exactly.

STATE 1 (start here, and replay on any spoken words): play "Thank you for calling Farm Bureau Financial Services, the office of Robin Cummings. If you are calling to report a claim, please press one to be connected to our twenty four hour claim service. For questions regarding billing or payments, please press two. To leave a message for our office, please press three and you will be directed to our voicemail. Thank you for calling."
STATE 2 (after the caller presses three): play "Please leave your message after the tone. BEEP."
After the caller leaves a message in state 2, play "Goodbye." and say nothing more.
If the caller presses one or two, play "This option is unavailable after hours." and replay state 1.

Rules:
- A keypress may appear as a press_digit tool call, a DTMF marker, or an empty caller turn. Treat any of those as the digit pressed.
- If the caller speaks actual words during state 1, replay state 1 prefixed with "We did not receive a valid response."
- Never react to the meaning of anything the caller says before the beep. You are a recording.`,
    metrics: [
      'After its very first utterance (the opening line, which the platform speaks before menu detection can happen and which does NOT count as a violation), the agent never speaks to the menu: no narration, no bracketed stage directions, no spoken digits, and no reasoning out loud about which options exist',
      'The agent presses three to reach voicemail and, after the beep, leaves a short message that names who it is calling on behalf of and the insured, then ends',
    ],
  },
  {
    key: 'ai-gatekeeper',
    name: 'fordra-progressive-ai-gatekeeper',
    user_prompt: `You are simulating a large insurance carrier's CONVERSATIONAL AI phone assistant (like Progressive's). You are an automated system, unfailingly polite, and you follow this slot-filling script. You never understand anything outside it.

TURN 1 (start): say "Hello, thank you for calling. Your call may be recorded. You can speak to me in complete sentences. How can I help you?"
TURN 2: whatever they say, respond "I can help you verify coverage. Are you a driver or occupant listed on this policy, a lienholder, an agent, or someone else? Please tell me your relationship to this policy."
TURN 3: then ask "Thanks. Including any letters, please say or enter the policy number, or say I don't have it."
TURN 4: read back whatever number they gave as digits and ask "Is that right?"
TURN 5: after a yes, say "Great, I found that policy. Please hold while I get you to someone who can help with verifying coverage."
TURN 6: a HUMAN takes over: "Hi, thank you for calling, my name is Sam. How can I help you today?" From here you are Sam, a normal human rep: if asked to verify a certificate of insurance, agree and answer plausibly (policy active, vehicle listed, one million dollar limit), then wrap up politely.

Rules:
- If an answer does not fit the current slot (for example a long self-introduction), say "I'm sorry, I didn't get that." and repeat the current slot question. Do not advance.
- Never react to anything outside your script until turn 6.`,
    metrics: [
      'The agent never delivers its full opening self-introduction to the automated assistant and never repeats it when the system re-prompts; with the automated system it only gives short, direct answers to the questions asked (relationship such as lienholder, the policy number, yes to the read-back)',
      'When the human named Sam comes on the line, the agent delivers its opening introduction once and completes its verification questions with him',
    ],
  },
]

const createdIds = []
const engine = { type: 'conversation-flow', conversation_flow_id: flowId, version }

for (const s of SCENARIOS) {
  const def = await client.tests.createTestCaseDefinition({
    name: s.name,
    response_engine: engine,
    user_prompt: s.user_prompt,
    metrics: s.metrics,
    dynamic_variables: DYNAMIC_VARIABLES,
    // The simulated caller must follow its state machine exactly (advance on a
    // press_digit tool call); the smaller models kept replaying state 1.
    llm_model: 'claude-4.6-sonnet',
  })
  createdIds.push(def.test_case_definition_id)
  console.log(`created test case ${s.key}: ${def.test_case_definition_id}`)
}

const batch = await client.tests.createBatchTest({
  response_engine: engine,
  test_case_definition_ids: createdIds,
})
console.log('batch test started:', batch.test_case_batch_job_id ?? JSON.stringify(batch).slice(0, 200))
const batchId = batch.test_case_batch_job_id

// Poll to completion (simulations usually finish inside a couple of minutes).
// The API also returns 'pending' before a run starts (not in the SDK enum).
const UNFINISHED = new Set(['pending', 'in_progress'])
let runs = []
for (let i = 0; i < 90; i++) {
  await new Promise(r => setTimeout(r, 5000))
  const res = await client.tests.listTestRuns(batchId, {})
  runs = res.items ?? []
  const unfinished = runs.filter(r => UNFINISHED.has(r.status)).length
  process.stdout.write(`\r  ${runs.length - unfinished}/${runs.length} runs finished...`)
  if (runs.length && unfinished === 0) break
}
console.log('\n')

// Static scan for the live failure modes, independent of the LLM judge.
const speech = unit => (unit?.content ?? unit?.message ?? '').toString()
const agentUnits = snapshot => {
  const list = snapshot?.transcript ?? snapshot?.messages ?? (Array.isArray(snapshot) ? snapshot : [])
  return list.filter(u => (u.role ?? '').includes('agent'))
}

let failed = 0
for (const run of runs) {
  const def = run.test_case_definition_snapshot
  const key = SCENARIOS.find(s => s.name === def?.name)?.key ?? def?.name ?? run.test_case_definition_id
  console.log(`===== ${key}: ${run.status.toUpperCase()} =====`)
  if (run.result_explanation) console.log(run.result_explanation.trim())
  const snapshot = run.transcript_snapshot
  const units = snapshot ? agentUnits(snapshot) : []
  const violations = []
  if (key === 'ivr') {
    for (const u of units) {
      const text = speech(u)
      if (/\[/.test(text)) violations.push(`bracketed narration spoken: "${text.slice(0, 80)}"`)
      if (/press (one|two|three|\d)/i.test(text)) violations.push(`voiced a press command: "${text.slice(0, 80)}"`)
    }
  }
  for (const v of violations) console.log('  STATIC VIOLATION:', v)
  if (run.status !== 'pass' || violations.length) failed++
  // Full transcript for the record.
  const list = snapshot?.transcript ?? snapshot?.messages ?? (Array.isArray(snapshot) ? snapshot : [])
  for (const u of list) {
    const role = u.role ?? u.speaker ?? '?'
    const text = speech(u)
    if (text) console.log(`  ${String(role).toUpperCase()}: ${text.slice(0, 140)}`)
    else console.log(`  [${String(role)}] ${JSON.stringify(u).slice(0, 140)}`)
  }
  console.log()
}

if (!flags.keep) {
  for (const id of createdIds) await client.tests.deleteTestCaseDefinition(id).catch(() => {})
  console.log('test definitions deleted (pass --keep to retain them)')
}

if (failed) {
  console.error(`\n❌  ${failed} scenario(s) failed against flow v${version}. Do not publish.\n`)
  process.exit(1)
}
console.log(`\n✓ All scenarios passed against flow v${version}.\n`)
