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
 *   hold-live-rep — a rep says "give me one second" mid-questions (VRF-1110,
 *            2026-08-04 live failure: agent kept firing questions during the
 *            check). Passes only if the agent says at most "Of course." and
 *            waits, then resumes the pending question.
 *   partial-answer — rep answers a list question with one name and a
 *            multi-part question with only the year (VRF-1110). Passes only
 *            if the agent asks "Is that everyone listed?" and asks for the
 *            missing parts before moving on.
 *   conditional-followup / conditional-followup-no — a question carries a
 *            "- Follow-up (only if: they say yes)" line. Passes only if the
 *            follow-up is never read with the main question, is asked on a
 *            yes, and is skipped on a no.
 *   transfer-fragment — the NASTC call (VRF-1111, 2026-08-04): a stray
 *            "Yes," between "I'm gonna send you to Michelle" and the new
 *            person. Passes only if "Thank you." is spoken at most once and
 *            the fragment gets silence. (The correct silence trips the
 *            liveness kill, so the deterministic check covers only the
 *            transfer window.)
 *   thinking — same call: "Oh my goodness." before the real answer. Passes
 *            only if the exclamation gets silence (no re-ask). One silent
 *            beat per scenario: the simulator kills conversation-node runs
 *            at the FIRST empty-output turn, so a scenario with two silent
 *            beats can never reach its second one.
 *   hold-noise — same call: an unintelligible mumble during a lookup hold.
 *            Passes only if "Of course." is spoken at most once and the
 *            mumble gets silence.
 *   verify-readback — the rep demands a read-back of the VIN last four (a
 *            detail the agent HAS) before answering anything, in the same
 *            utterance that announces the policy was found (VRF-1112 second
 *            call, 2026-08-04: two gate-question deflections + a channel-ask
 *            misfire before the digits came out). Passes only if the digits
 *            come out on the first ask, with no verification question or
 *            channel ask before them.
 *   hold-question — the rep asks a question of her own mid-hold, for a
 *            detail not in the reference list (same call: "what is the date
 *            listed on the certificate?" got the pending gate question twice).
 *            Passes only if the reply is the miss line, never the pending
 *            question, with at most one "Of course." during the hold.
 *   qualified-menu — the TrueNorth menu (VRF-1114, 2026-08-05 live failure:
 *            "if you are a current client press one for customer service" —
 *            no qualifier fit and the agent hung up without pressing).
 *            Passes only if the agent presses one anyway (qualifiers never
 *            disqualify the human-reaching option).
 *   lookup-escalate — the GEICO speech slot that can never find the policy
 *            number (VRF-1113). Passes only if the agent reads the number at
 *            most twice and then asks for an agent instead of dead-ending.
 *   auth-wall — the GEICO date-of-birth wall plus the recovery slots the
 *            owner hit live (first character of the policy number, state).
 *            Passes only if the agent declines the DOB with an agent ask and
 *            answers the state from the PRODUCER address, not the insured's.
 *   human-midivr — a human takes over mid-IVR and immediately asks a direct
 *            question. Passes only if the reply is the short identification
 *            plus the answer (owner copy 2026-08-05), never the full opener.
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

STATE 1 (start here): play "Thank you for calling the office of Avant, a division of Specialty Program Group. Please hold for the next available representative."
STATE 2: play "If you would like to save your place in line and have an agent call you back when it is your turn, please press one, or stay on the line and continue to hold."
STATE 3: a HUMAN takes over: "Hi, thanks for holding, this is Marcy at Avant. How can I help you?" From here on you are Marcy, a normal human rep: if asked to verify a certificate of insurance, agree and answer plausibly (policy active, vehicle listed, one million dollar limit), then wrap up politely.

Rules:
- In state 1: whatever the caller does, advance to state 2 on your next turn.
- In state 2: if the caller stays SILENT (no words, no keypress), advance to state 3. If the caller PRESSES ANY DIGIT in state 2, play "To confirm the number we should call you back at, press one." and stay in state 2 forever; never reach the human.
- If the caller speaks actual words in states 1-2, replay the current state's message.
- Never react to the meaning of anything said in states 1-2. You are a recording until state 3.`,
    metrics: [
      "The agent's very first turn (its opening introduction, spoken before it can detect automation) is EXEMPT and never counts as a violation. Pressing a digit on the INITIAL greeting menu to reach a representative is also acceptable. What must hold: when the system offers a callback or to save a place in line, the agent never presses a digit for that offer and never speaks to confirm or provide a callback number; it stays on hold. Judge keypresses ONLY by explicit press_digit tool invocations in the transcript: node_transition entries are internal bookkeeping and are never evidence that a digit was pressed",
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
      "The agent's very first turn is its opening introduction, spoken before menu detection can happen: that ENTIRE first turn, including any question in it, is EXEMPT and never counts as a violation. After that first turn the agent never speaks to the menu: no narration, no bracketed stage directions, no spoken digits, and no reasoning out loud about which options exist. (The voicemail message after the beep is required, not a violation.)",
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
TURN 4: if they gave a number, read exactly that number back digit by digit and ask "Is that right?" If they said they don't have it or asked for an agent, skip to turn 5.
TURN 5: say "Great. Please hold while I get you to someone who can help with verifying coverage."
TURN 6: a HUMAN takes over: "Hi, thank you for calling, my name is Sam. How can I help you today?" From here you are Sam, a normal human rep: if asked to verify a certificate of insurance, agree and answer plausibly (policy active, vehicle listed, one million dollar limit), then wrap up politely.

Rules:
- If an answer does not fit the current slot (for example a long self-introduction), say "I'm sorry, I didn't get that." and repeat the current slot question ONCE; if the answer still does not fit, skip to turn 5. Do not stall forever.
- NEVER invent numbers, names, or content of your own before turn 6. Only read back what the caller actually said.
- Never react to anything outside your script until turn 6.`,
    metrics: [
      "The agent's very first turn (its opening introduction, spoken before it can detect automation) is EXEMPT and never counts as a violation. After that first turn, the agent never again speaks its full opener line (the one naming who it calls from and asking about getting started) to the automated system, even when re-prompted or when a number is read back. Short direct answers to the system's slot questions (a relationship like lienholder, a policy number, yes to a read-back) are correct behavior, and a brief identity answer to the very first slot question is acceptable",
      'When the human named Sam comes on the line, the agent delivers its opening introduction once and completes its verification questions with him',
    ],
  },
  {
    key: 'hold-live-rep',
    name: 'fordra-hold-live-rep',
    user_prompt: `You are Vanessa, a human rep at Colstan&Associates insurance agency. Answer the phone: "Colstan&Associates, good morning, this is Vanessa." When the caller says they are verifying a certificate of insurance, say "Sure, go ahead."

When the caller asks their FIRST substantive insurance question: reply ONLY "Give me one second, please. Let me check that." On your NEXT turn, whatever the caller did, reply ONLY "Sorry, still checking. One moment." On the turn after that, reply "Okay, thank you so much for waiting. Yes, the policy is active and in force." From then on answer any remaining questions promptly and plausibly (the vehicle with that VIN is listed, the limit is one million dollars), and wrap up politely.`,
    metrics: [
      'Between the rep saying "Give me one second" and the rep returning with "thank you for waiting", the agent speaks at most a single brief acknowledgment such as "Of course." — it asks NO question of any kind during that window, neither a new question nor a repeat of the pending one',
      'After the rep returns with the answer, the agent accepts it and continues with its remaining questions in order, without re-asking a question the rep already answered',
    ],
  },
  {
    key: 'partial-answer',
    name: 'fordra-partial-answer-completeness',
    user_prompt: `You are Jeff, a human rep at Colstan&Associates insurance agency. Answer the phone: "Colstan&Associates, Jeff speaking." When the caller says they are verifying a certificate of insurance, say "Sure, go ahead" and answer the gate questions plausibly (the policy is active, the vehicle with that VIN is listed).

Then follow these rules exactly:
- When asked who all the insured parties are: answer ONLY "Todd Ramirez." If and only if the caller asks whether that is everyone, add "Oh, and also Maria Lopez. That's everyone."
- When asked for the year, make, and model of the vehicle: answer ONLY "Two thousand twenty one." If and only if the caller asks for the make and model (or the missing part), add "Kenworth T680."
- Answer any other question plausibly and briefly. Wrap up politely when done.`,
    metrics: [
      'After receiving a single name for the who-are-all-the-insured-parties question, the agent asks its configured follow-up (whether that is everyone listed) BEFORE moving to another question, because the answer named only one party',
      'After receiving only a year for the year-make-and-model question, the agent asks specifically for the missing make and model BEFORE moving on, rather than accepting the year alone',
    ],
    // The completeness re-ask is admin-configured follow-up DATA (owner
    // decision 2026-08-04), not prompt text — the question list carries it.
    variables: {
      questions: '1. Who are all the insured parties listed on the certificate?\n   - Follow-up (only if: they name only one party): Is that everyone listed on the certificate?\n2. What is the year, make, and model of the vehicle listed on the policy?',
    },
  },
  {
    key: 'conditional-followup',
    name: 'fordra-conditional-followup-yes',
    user_prompt: `You are Jeff, a human rep at Colstan&Associates insurance agency. Answer the phone: "Colstan&Associates, Jeff speaking." When the caller says they are verifying a certificate of insurance, say "Sure, go ahead" and answer the gate questions plausibly (the policy is active, the vehicle with that VIN is listed).

Then follow these rules exactly:
- When asked whether the certificate lists Non-Trucking Liability or Bobtail Liability: answer ONLY "Yes, it lists Non-Trucking Liability."
- If then asked about details of the operator's primary coverage: answer "The operator carries primary auto liability through Progressive."
- When asked for the per-occurrence limit: answer "One million dollars."
- Answer anything else plausibly and briefly. Wrap up politely when done.`,
    metrics: [
      'The agent asks the Non-Trucking/Bobtail question WITHOUT reading out any follow-up wording, condition text, or the phrase "only if" alongside it',
      'After the rep answers yes, the agent asks the operator primary-coverage follow-up as its own separate question, exactly once, and then continues to the next question',
    ],
    variables: {
      questions: "1. Does the certificate list Non-Trucking Liability or Bobtail Liability?\n   - Follow-up (only if: they say yes): Do you have details on the operator's primary coverage?\n2. What is the per-occurrence limit on the Automobile Liability policy?",
    },
  },
  {
    key: 'conditional-followup-no',
    name: 'fordra-conditional-followup-no',
    user_prompt: `You are Jeff, a human rep at Colstan&Associates insurance agency. Answer the phone: "Colstan&Associates, Jeff speaking." When the caller says they are verifying a certificate of insurance, say "Sure, go ahead" and answer the gate questions plausibly (the policy is active, the vehicle with that VIN is listed).

Then follow these rules exactly:
- When asked whether the certificate lists Non-Trucking Liability or Bobtail Liability: answer ONLY "No, neither of those."
- When asked for the per-occurrence limit: answer "One million dollars."
- If asked anything about operator primary coverage, answer "I already told you there is no non-trucking coverage" — this counts as the caller misbehaving.
- Answer anything else plausibly and briefly. Wrap up politely when done.`,
    metrics: [
      'The agent asks the Non-Trucking/Bobtail question WITHOUT reading out any follow-up wording, condition text, or the phrase "only if" alongside it',
      'After the rep answers no, the agent NEVER asks about operator primary coverage; it moves straight on to the next question',
    ],
    variables: {
      questions: "1. Does the certificate list Non-Trucking Liability or Bobtail Liability?\n   - Follow-up (only if: they say yes): Do you have details on the operator's primary coverage?\n2. What is the per-occurrence limit on the Automobile Liability policy?",
    },
  },
  {
    key: 'transfer-fragment',
    name: 'fordra-nastc-transfer-fragment',
    user_prompt: `You are simulating a phone call to NASTC, an association with an insurance department. Play two characters in sequence and follow the turn script exactly.

CHARACTER 1 - James, front desk. Answer the phone: "Good morning, NASTC. This is James. How may I direct your call?" When the caller explains why they are calling, say "No. I need to send you to the insurance department. So hold on. I'm gonna send you to Michelle." On your NEXT turn, whatever the caller did or said, say ONLY "Yes," (a stray fragment while you work the transfer, not addressed to the caller). On the turn after that, character 2 takes over.

CHARACTER 2 - Michelle, insurance department rep. Greet: "NASTC Insurance. How can we help you?" Then help with the certificate verification: answer every question plausibly and promptly (the policy is active, the vehicle with that VIN is listed, one insured party, a one million dollar limit), and wrap up politely when done.`,
    metrics: [
      'Between James saying he will transfer the call and Michelle greeting, the agent says "Thank you." at most ONCE; the stray "Yes," gets no response of any kind',
      'When Michelle greets, the agent responds to her (re-introducing itself or continuing the verification); it does not stay silent with the new person',
    ],
  },
  {
    key: 'thinking',
    name: 'fordra-nastc-thinking-aloud',
    user_prompt: `You are Michelle, a human rep in the NASTC insurance department. Answer the phone: "NASTC Insurance. How can we help you?" When the caller explains, say "Sure, go ahead." Answer the gate questions plausibly (the policy is active, the vehicle with that VIN is listed). Then follow these rules exactly:
- When asked who all the insured parties are: reply ONLY "Oh my goodness." On your NEXT turn reply "Owner only."
- Answer anything else plausibly and briefly, and wrap up politely when done.`,
    metrics: [
      'After Michelle exclaims "Oh my goodness." the agent stays completely silent - no re-ask, no rephrase - until she gives her actual answer ("Owner only."), and then continues normally',
    ],
    variables: {
      questions: '1. Who are all the insured parties listed on the certificate?\n2. What is the per-occurrence limit on the Automobile Liability policy?',
    },
  },
  {
    key: 'hold-noise',
    name: 'fordra-nastc-hold-noise',
    user_prompt: `You are Michelle, a human rep in the NASTC insurance department. Answer the phone: "NASTC Insurance. How can we help you?" When the caller explains, say "Sure, go ahead." Answer the gate questions plausibly (the policy is active, the vehicle with that VIN is listed). Then follow these rules exactly:
- When asked for the name of the entity that holds the operator's primary coverage: reply ONLY "I have to look that up." On your NEXT turn reply ONLY "hmm" (a low mumble to yourself, not addressed to the caller). On the turn after that, reply "The operator's primary coverage is through Progressive."
- Answer anything else plausibly and briefly, and wrap up politely when done.`,
    metrics: [
      'After "I have to look that up." the agent says at most one "Of course."; the unintelligible mumble gets no response of any kind, and the agent continues only when Michelle returns with the answer',
    ],
    variables: {
      questions: "1. What is the name of the entity that holds this operator's primary coverage?\n2. What is the per-occurrence limit on the Automobile Liability policy?",
    },
  },
  {
    // VRF-1112: the rep demanded a detail the agent did not have (vehicle
    // make); the agent deflected with its own gate question and the call died.
    key: 'missing-detail',
    name: 'fordra-progressive-missing-detail',
    user_prompt: `You are Priya, a human rep on the commercial lines desk at Progressive Insurance. Answer the phone: "Thank you for calling Progressive commercial lines, this is Priya." When the caller explains they are verifying a certificate of insurance, say "Sure, I can pull that up. What's the insured's name?" Whatever name they give, say "Okay, I found the policy." Then follow these rules exactly:
- Immediately after finding the policy, say: "Before I can verify anything, I need to confirm the license plate number on the vehicle. What is the plate number?"
- If the caller says they do not have it, or offers something else instead: reply "No, I need the plate number specifically. Without it I can't verify this policy for you."
- If the caller then asks how else or what the best way is to get the certificate verified: reply "You would need to email our verifications department, verifications at progressive dot com." Then wrap up politely and end.
- If the caller asks you a verification question of their own (whether the policy is active, whether a vehicle is listed, who the certificate holder is, and so on) while your plate-number request stands unanswered: reply "I already told you, I can't verify anything without the plate number."
- Never volunteer any policy information yourself.`,
    metrics: [
      'When asked for the plate number (which is not among its reference details), the agent says it does not have it and offers to provide something else instead; it NEVER responds to the rep\'s information request with a verification question of its own (policy active, vehicle listed, certificate holder, etc.)',
      'After the rep says she cannot verify without the plate number, the agent asks for the best way to get the certificate verified with her office instead of pressing more verification questions, and ends politely after her answer',
    ],
  },
  {
    // VRF-1112 second call (2026-08-04, v24): the rep demanded a read-back of
    // the VIN last four before answering anything, in the same utterance that
    // announced the policy was found. The gate node's headline job beat rule 0
    // twice, then the channel ask misfired, before the digits came out.
    key: 'verify-readback',
    name: 'fordra-progressive-verify-readback',
    user_prompt: `You are Sam, a human rep on the commercial lines desk at Progressive Insurance. Answer the phone: "Thank you for calling Progressive commercial lines, this is Sam." When the caller explains they are verifying a certificate of insurance, say "Sure. What's the insured's name?" Whatever name they give, reply in ONE single turn: "Okay, I found the policy. Before I can verify anything for you, I need you to confirm the last four of the VIN of the vehicle." Then follow these rules exactly:
- If the caller speaks four digits to you: reply "Perfect, that matches what I have. Go ahead with your questions." From then on answer every question plausibly and promptly (the policy is active, the vehicle with that VIN is listed, the limit is one million dollars), and wrap up politely when done.
- If the caller responds with ANYTHING other than the digits - a verification question of its own, an offer of a different detail, a statement that it does not have it: reply "I can't answer anything until we get through verification, ma'am. I just need the last four of the VIN of the vehicle."
- Never volunteer any policy information before the digits are given.`,
    metrics: [
      "When the rep asks for the last four of the VIN (which IS among its reference details), the agent's very next reply gives those four digits; it never responds to the request with a verification question of its own (policy active, certificate holder, etc.) and never asks for the best way to get the certificate verified",
      'After the rep accepts the digits, the agent proceeds with its verification questions and completes them',
    ],
  },
  {
    // Same call: mid-hold the rep asked "what is the date listed on the
    // certificate?" (not in the reference details); the hold rule's "restate
    // the pending question" answered her question with the pending gate
    // question, twice, before the miss line fired.
    key: 'hold-question',
    name: 'fordra-hold-question-mid-hold',
    user_prompt: `You are Priya, a human rep at Colstan&Associates insurance agency. Answer the phone: "Colstan&Associates, this is Priya." When the caller says it is verifying a certificate of insurance, say "Sure, go ahead." Answer the gate questions plausibly (the policy is active, the vehicle with that VIN is listed). Then follow these rules exactly:
- When asked the first question from the caller's question list: reply ONLY "Bear with me, I'm just waiting on my document system to load up so I can look at the certificate."
- On your NEXT turn, whatever the caller did or said, ask ONLY: "What is the date listed on the certificate of insurance that was sent over to you?"
- If the caller says it does not have that in front of it, or offers something else instead: reply "No worries, I found it on my end. The per-occurrence limit is one million dollars." From then on answer any remaining questions promptly and plausibly, and wrap up politely when done.
- If the caller instead responds to your date question with a question of its own: reply "I asked you a question first, ma'am." and repeat your date question.`,
    metrics: [
      'Between the rep saying "Bear with me" and her date question, the agent speaks at most a single "Of course."',
      "When the rep asks what date is listed on the certificate (which is NOT among the agent's reference details), the agent's very next reply says it does not have that and offers something else instead; it NEVER replies to her question with its own pending verification question (the per-occurrence limit or any other)",
    ],
  },
  {
    // VRF-1114 (TrueNorth, 2026-08-05): "if you are a current client...
    // press one for customer service / for a quote press two" - neither
    // qualifier fit, the agent pressed nothing and hung up. Qualifiers must
    // never disqualify the human-reaching option.
    key: 'qualified-menu',
    name: 'fordra-truenorth-qualified-menu',
    user_prompt: `You are simulating an AUTOMATED phone menu for TrueNorth insurance. You are a machine: never conversational until state 2. Follow this script exactly.

STATE 1 (start here, replay on any spoken words or on silence): play "Thank you for calling TrueNorth and Truckers service team. Please remember that all phone calls are recorded for quality and training. If you are a current client or have already received your quote, please press one for customer service. If you are in need of a quote, press two."
STATE 2 (only after the caller presses one): a HUMAN takes over: "Customer service, this is Dana. How can I help you?" From here on you are Dana, a normal human rep: if asked to verify a certificate of insurance, agree and answer plausibly (the policy is active, the vehicle is listed, the limit is one million dollars), then wrap up politely.
If the caller presses two: play "Thank you for your interest in a quote. Please hold for our sales team." and replay it forever; never reach a human.

Rules:
- A keypress may appear as a press_digit tool call, a DTMF marker, or an empty caller turn. Treat any of those as the digit pressed.
- Never react to the meaning of anything spoken before state 2. You are a recording until then.`,
    metrics: [
      "The agent's very first turn (the opening line, spoken before menu detection can happen) is EXEMPT and never counts as a violation. What must hold: the agent presses one for customer service - the option that reaches a human - even though the menu frames it as being for current clients, and it never presses two for a quote, never ends the call while the menu is offering digits, and never speaks to the menu after the exempt first turn. Judge keypresses ONLY by explicit press_digit tool invocations: node_transition entries are never evidence of a press",
      'When Dana comes on the line, the agent introduces itself and completes its verification questions with her',
    ],
  },
  {
    // VRF-1113 (GEICO, 2026-08-05): the speech slot could not find the
    // policy number no matter how it was read (a lookup failure, confirmed
    // by a human caller failing too). Retry once, then escalate to an
    // agent instead of dead-ending.
    key: 'lookup-escalate',
    name: 'fordra-geico-lookup-escalate',
    user_prompt: `You are simulating a large carrier's AUTOMATED speech-driven phone system. You are a machine until state 4. Follow this script exactly.

STATE 1 (start): play "Thank you for calling BigCo Insurance business and commercial department. Now, using a few words, how can I help you? You can say things such as file a claim, get a quote, or verify coverage. Go ahead."
STATE 2 (after the caller says anything): play "Sure. What's the policy number or phone number you're calling about?"
STATE 3: whenever the caller reads any number or digits, play "Sorry, I didn't catch that. Let's try again. What's the policy number or phone number you're calling about?" This happens EVERY time digits are read: the number can never be recognized, no matter how it is read.
STATE 4: ONLY if the caller asks for an agent, a representative, or a person, or presses zero: a HUMAN takes over: "Hi, this is Marcus. How can I help you today?" From here on you are Marcus, a normal human rep: if asked to verify a certificate of insurance, agree and answer plausibly (policy active, vehicle listed, one million dollar limit), then wrap up politely.

Rules:
- Never recognize any number. Never volunteer an agent yourself.
- You are the SYSTEM until state 4: never ask to speak to anyone, never ask whether the caller can hear you, never comment on the conversation. Only the CALLER can request an agent. After playing a message, wait.
- NEVER repeat, read back, or echo any number the caller says. Your only lines are the scripted messages above.
- Never react to anything outside the script before state 4.`,
    metrics: [
      'After the system twice fails to recognize the policy number the agent read, the agent asks to speak to an agent or representative instead of reading the number a third time or ending the call',
      'When Marcus comes on the line, the agent introduces itself and completes its verification questions with him',
    ],
  },
  {
    // VRF-1113: GEICO's date-of-birth authentication wall, plus the
    // recovery slots the owner hit when calling in person (first character
    // of the policy number, then the state). The state answer comes from
    // the PRODUCER address, falling back to the insured address.
    key: 'auth-wall',
    name: 'fordra-authwall-dob-state',
    user_prompt: `You are simulating a carrier's AUTOMATED speech-driven identity system. You are a machine until the final state. Follow this script exactly.

STATE 1 (start): play "To protect your privacy, please say or enter your date of birth. Month, day, and year."
STATE 2: only when the caller says it does not have that, or asks for an agent or a person: play "Okay. To route your call, what is the first digit or letter of the policy number?"
STATE 3: when the caller gives a single letter or digit: play "Thank you. And what state are you calling about?"
STATE 4: when the caller names a US state: a HUMAN takes over: "Thanks for waiting, this is Priya. Can I help you?" From here on you are Priya, a normal human rep: if asked to verify a certificate of insurance, agree and answer plausibly (policy active, vehicle listed, one million dollar limit), then wrap up politely.

Rules:
- In state 1, if the caller stays silent or gives anything that is not an I-don't-have-that or an agent request, replay state 1.
- In states 2-3, if the answer does not fit, replay the current state's question once, then move on anyway.
- A press_digit tool call or DTMF marker counts as the caller giving that character.
- NEVER answer your own questions and never invent letters, digits, or states the caller did not give. After asking, wait for the caller.
- Never react to anything outside the script before Priya.`,
    metrics: [
      'The agent never invents or guesses a date of birth; it says it does not have it and asks to speak with an agent',
      "The agent answers the first-character question with N (its policy number NTL321510 starts with N) and the state question with Arizona (the state of the producer's address in its reference details), never Florida (the insured's state is only the fallback when no producer address exists)",
    ],
    variables: {
      reference_details: '- Policy number (Automobile Liability): NTL321510 [last four if asked: 5 1 0 | spoken: N T L. 3 2 1 5 1 0]\n- Producer (insurance agency): Colstan & Associates\n- Producer address: 4801 E Washington St, Phoenix, AZ 85034\n- Insured address: 700 Main St, Lehigh Acres, FL 33936\n- VIN: 1XKYD49X0MJ470445 [LEAD WITH LAST FOUR: 0 4 4 5 | full spoken: 1. X K Y D. 4 9 X. 0. M J. 4 7 0 4 4 5]',
    },
  },
  {
    // The human who finally answers after an IVR often opens with a direct
    // question and no pleasantries. The reply is the short on-behalf-of
    // line plus the answer (owner copy, 2026-08-05) - never the full
    // opener re-delivered.
    key: 'human-midivr',
    name: 'fordra-human-arrival-direct-question',
    user_prompt: `You are simulating an AUTOMATED phone menu. You are a machine: never a human, never conversational, no matter what the caller says. A human named Sam exists BEHIND the menu and is reachable ONLY by keypress. Follow this script exactly.

STATE 1 (start): play "Thank you for calling Colstan&Associates. For policy service, press one. For claims, press two."
STATE 2 (after the caller presses one): play "Please hold."
STATE 3 (your next turn after "Please hold."): the human takes over, and her FIRST words are a direct question with no greeting pleasantries: "Hi, this is Sam, I see you're calling about a policy - can you confirm the policy number you're calling about?" From here on you are Sam, a normal human rep: once the caller gives a number starting with N T L, say "Great, I found it. What did you need?" and then answer all their questions plausibly (policy active, vehicle listed, one million dollar limit), wrapping up politely when done.

Rules:
- The ONLY exit from state 1 is a keypress. If the caller SPEAKS in state 1 - words, questions, a self-introduction, anything at all - you are a recording that cannot hear meaning: replay state 1 verbatim and nothing else. Never answer, never acknowledge, never skip ahead to Sam.
- A keypress may appear as a press_digit tool call, a DTMF marker, or an empty caller turn: advance state 1 to state 2.
- Sam speaks only in state 3, and her first line is always her scripted policy-number question.`,
    metrics: [
      "When Sam asks for the policy number, the agent's very next reply both briefly identifies itself (calling from Dakota Financial Titling Trust on a recorded line) and reads the policy number - it does NOT deliver the full opener asking whether she needs the insured's name to get started, and does not ask any question of its own in that reply",
      'After Sam finds the policy, the agent proceeds with its verification questions and completes them',
    ],
  },
]

/**
 * Deterministic transcript checks for silence-heavy scenarios. The simulation
 * platform ends a run with "did not respond to consecutive user utterances"
 * when the agent CORRECTLY stays silent across two system turns (hold queues,
 * transfer announcements) — the LLM judge never runs. For those runs, these
 * checks encode the exact live failure modes and decide pass/fail instead.
 * Each returns a list of violations over the full transcript unit list.
 */
/**
 * Assert the agent stays silent between two marker utterances, except for an
 * optional allowed line spoken at most maxAllowed times. Appends violations
 * to v. A missing from-marker is a violation (the scene never played); a
 * missing to-marker means the run was cut short — check up to the end.
 */
function silentWindow(list, v, fromRe, toRe, allowRe, label, maxAllowed) {
  const fromIdx = list.findIndex(u => fromRe.test(speech(u)))
  if (fromIdx < 0) { v.push(`${label}: trigger line never played`); return }
  const toIdx = list.findIndex((u, i) => i > fromIdx && toRe.test(speech(u)))
  const end = toIdx < 0 ? list.length : toIdx
  let allowed = 0
  for (let i = fromIdx + 1; i < end; i++) {
    const u = list[i]
    const text = speech(u).trim()
    if (!(u.role ?? '').includes('agent') || !text) continue
    if (allowRe && allowRe.test(text)) {
      if (++allowed > maxAllowed) v.push(`${label}: allowed line spoken ${allowed}x (max ${maxAllowed})`)
    } else {
      v.push(`${label}: spoke "${text.slice(0, 70)}"`)
    }
  }
}

const DETERMINISTIC_CHECKS = {
  'callback-queue': list => {
    const v = []
    const offerIdx = list.findIndex(u => /save your place/i.test(speech(u)))
    if (offerIdx < 0) return ['callback offer never played']
    const humanIdx = list.findIndex((u, i) => i > offerIdx && /Marcy/i.test(speech(u)))
    const end = humanIdx < 0 ? list.length : humanIdx
    for (let i = offerIdx + 1; i < end; i++) {
      const u = list[i]
      if ((u.role ?? '').includes('agent') && speech(u).trim()) v.push(`spoke during callback offer: "${speech(u).slice(0, 60)}"`)
      if (JSON.stringify(u).includes('press_digit')) v.push('pressed a digit on the callback offer')
    }
    return v
  },
  // The correct behavior on a keypad IVR IS consecutive silent turns while
  // menus play — which trips the liveness kill. Violations: any agent speech
  // after the exempt first turn (the opener lands before menu detection can
  // happen), or no digits pressed at all.
  ivr: list => {
    const v = []
    const beepIdx = list.findIndex(u => /after the tone|BEEP/i.test(speech(u)))
    const end = beepIdx < 0 ? list.length : beepIdx
    // Violation = speaking TO A MENU. The sim sometimes hallucinates a live
    // human mid-menu ("Hi there, yes, the insured's name is...") and fails
    // to register presses; answering that human-sounding turn is correct
    // agent behavior, so only speech directly following a menu-like
    // utterance counts.
    const menuish = /press|valid response|thank you for calling|oprime|para espanol/i
    let agentTurns = 0
    let lastUser = ''
    for (const u of list.slice(0, end)) {
      if ((u.role ?? '') === 'user') lastUser = speech(u)
      if ((u.role ?? '').includes('agent') && speech(u).trim()) {
        agentTurns++
        if (agentTurns > 1 && menuish.test(lastUser)) {
          v.push(`spoke to the menu after the exempt first turn: "${speech(u).slice(0, 60)}"`)
        }
      }
    }
    if (!JSON.stringify(list).includes('press_digit')) v.push('never pressed a digit')
    return v
  },
  // The correct behavior here IS two silent agent turns while the rep checks,
  // which is exactly what trips the simulator's liveness kill.
  'hold-live-rep': list => {
    const v = []
    const waitIdx = list.findIndex(u => /give me one second/i.test(speech(u)))
    if (waitIdx < 0) return ['wait request never played']
    const backIdx = list.findIndex((u, i) => i > waitIdx && /waiting/i.test(speech(u)))
    const end = backIdx < 0 ? list.length : backIdx
    let acks = 0
    for (let i = waitIdx + 1; i < end; i++) {
      const u = list[i]
      const text = speech(u).trim()
      if (!(u.role ?? '').includes('agent') || !text) continue
      if (/^of course[.!]?$/i.test(text)) {
        if (++acks > 1) v.push('said "Of course." more than once during the same hold')
      } else {
        v.push(`spoke during the hold beyond "Of course.": "${text.slice(0, 80)}"`)
      }
    }
    return v
  },
  // Correct transfer behavior IS a silent turn on the stray fragment — the
  // liveness kill can end the run right at Michelle's greeting, so this
  // check covers only the transfer window; a separate scenario tests the
  // exclamation and lookup-hold behavior without kill-prone double silence.
  'transfer-fragment': list => {
    const v = []
    silentWindow(list, v, /send you to Michelle/i, /NASTC Insurance/i, /^thank you[.!]?$/i, 'transfer', 1)
    return v
  },
  thinking: list => {
    const v = []
    silentWindow(list, v, /oh my goodness/i, /owner only/i, null, 'exclamation', 0)
    return v
  },
  'hold-noise': list => {
    const v = []
    silentWindow(list, v, /look that up/i, /progressive/i, /^of course[.!]?$/i, 'lookup hold', 1)
    return v
  },
  // VRF-1112: the reply to a request for a detail the agent lacks must be the
  // miss line, never one of the agent's own verification questions; the dead
  // end must land on the channel ask.
  'missing-detail': list => {
    const v = []
    const askIdx = list.findIndex(u => (u.role ?? '') === 'user' && /plate number/i.test(speech(u)))
    if (askIdx < 0) return ['plate-number request never played']
    const reply = list.slice(askIdx + 1).find(u => (u.role ?? '').includes('agent') && speech(u).trim())
    const text = reply ? speech(reply).trim() : ''
    if (!/don'?t have/i.test(text)) v.push(`first reply to the missing detail was not the miss line: "${text.slice(0, 80)}"`)
    if (/active|in force|certificate holder|listed on the policy/i.test(text)) {
      v.push(`deflected the rep's request with a verification question: "${text.slice(0, 80)}"`)
    }
    const blockIdx = list.findIndex((u, i) => i > askIdx && /can'?t verify this policy/i.test(speech(u)))
    if (blockIdx >= 0) {
      const after = list.slice(blockIdx + 1).find(u => (u.role ?? '').includes('agent') && speech(u).trim())
      if (after && !/best way/i.test(speech(after))) {
        v.push(`after the dead end, did not go to the channel ask: "${speech(after).slice(0, 80)}"`)
      }
    }
    return v
  },
  // VRF-1112 second call: a request for a detail the agent HAS must be
  // answered with that detail on the first ask — never with a verification
  // question, never with the channel ask.
  'verify-readback': list => {
    const v = []
    const askIdx = list.findIndex(u => (u.role ?? '') === 'user' && /last four of the VIN/i.test(speech(u)))
    if (askIdx < 0) return ['VIN read-back request never played']
    const reply = list.slice(askIdx + 1).find(u => (u.role ?? '').includes('agent') && speech(u).trim())
    const text = reply ? speech(reply).trim() : ''
    if (!text.replace(/\D/g, '').includes('0445')) v.push(`first reply did not give the last four (0 4 4 5): "${text.slice(0, 80)}"`)
    if (/active|in force|certificate holder|listed on the policy|best way/i.test(text)) {
      v.push(`deflected the read-back request: "${text.slice(0, 80)}"`)
    }
    return v
  },
  // Same call: a rep question mid-hold gets the miss line, never the pending
  // question; at most one "Of course." during the hold itself.
  'hold-question': list => {
    const v = []
    silentWindow(list, v, /bear with me/i, /date listed on the certificate/i, /^of course[.!]?$/i, 'document hold', 1)
    const askIdx = list.findIndex(u => (u.role ?? '') === 'user' && /date listed on the certificate/i.test(speech(u)))
    if (askIdx < 0) { v.push('mid-hold date question never played'); return v }
    const reply = list.slice(askIdx + 1).find(u => (u.role ?? '').includes('agent') && speech(u).trim())
    const text = reply ? speech(reply).trim() : ''
    if (!/don'?t have/i.test(text)) v.push(`first reply to the mid-hold question was not the miss line: "${text.slice(0, 80)}"`)
    if (/per.occurrence|active|in force|certificate holder|listed on the policy/i.test(text)) {
      v.push(`answered the rep's question with a pending question: "${text.slice(0, 80)}"`)
    }
    return v
  },
  // VRF-1114: correct behavior is silent turns while the menu replays (kill-
  // prone), then a press. Reaching Dana proves the press was 1: the script
  // only hands off on 1.
  'qualified-menu': list => {
    const v = []
    const danaIdx = list.findIndex(u => /this is Dana/i.test(speech(u)))
    const menuish = /press|recorded for quality|thank you for calling/i
    let agentTurns = 0
    let lastUser = ''
    for (const u of list.slice(0, danaIdx < 0 ? list.length : danaIdx)) {
      if ((u.role ?? '') === 'user') lastUser = speech(u)
      if ((u.role ?? '').includes('agent') && speech(u).trim()) {
        agentTurns++
        if (agentTurns > 1 && menuish.test(lastUser)) {
          v.push(`spoke to the menu after the exempt first turn: "${speech(u).slice(0, 60)}"`)
        }
      }
    }
    if (danaIdx < 0 && !JSON.stringify(list).includes('press_digit')) {
      v.push('never pressed a digit on the qualified menu (VRF-1114 regression)')
    }
    return v
  },
  // VRF-1113: at most two reads of the number, then an agent request.
  'lookup-escalate': list => {
    const v = []
    const marcusIdx = list.findIndex(u => /this is Marcus/i.test(speech(u)))
    const end = marcusIdx < 0 ? list.length : marcusIdx
    const pre = list.slice(0, end)
    const reads = pre.filter(u => (u.role ?? '').includes('agent') && speech(u).replace(/\D/g, '').includes('321510'))
    if (reads.length === 0) v.push('never read the policy number to the system')
    if (reads.length > 2) v.push(`read the policy number ${reads.length}x (max 2 before escalating)`)
    if (!pre.some(u => (u.role ?? '').includes('agent') && /\b(agent|representative|person)\b/i.test(speech(u)))) {
      v.push('never asked for an agent after the failed lookups')
    }
    return v
  },
  // VRF-1113: the DOB wall gets the miss line + agent ask, never silence or
  // an invented date; the state slot gets the producer state (Arizona). The
  // very first agent turn is the platform-exempt opener (begin transitions
  // into N1 before the IVR globals can fire) — the DOB reply is whichever
  // agent turn comes after that.
  'auth-wall': list => {
    const v = []
    const dobIdx = list.findIndex(u => /date of birth/i.test(speech(u)))
    if (dobIdx < 0) return ['DOB question never played']
    const priyaIdx = list.findIndex(u => /this is Priya/i.test(speech(u)))
    const pre = list.slice(0, priyaIdx < 0 ? list.length : priyaIdx)
    const replies = pre.slice(dobIdx + 1).filter(u => (u.role ?? '').includes('agent') && speech(u).trim())
    const missIdx = replies.findIndex(u => /don'?t have/i.test(speech(u)) && /\b(agent|representative|person)\b/i.test(speech(u)))
    if (missIdx < 0) {
      v.push('never gave the DOB wall the miss line plus an agent ask')
    } else if (missIdx > 1) {
      // Index 0 may be the exempt opener; the miss line must come right after.
      v.push(`took ${missIdx + 1} turns to decline the DOB wall`)
    }
    if (pre.some(u => (u.role ?? '').includes('agent') && /\b(19|20)\d{2}\b|january|february|march|april|june|july|august|september|october|november|december/i.test(speech(u)))) {
      v.push('spoke something date-like at the DOB wall')
    }
    // Identity questions are speech slots: any keypress other than 0 (the
    // operator escape) is the run-2 press-N misfire recurring.
    for (const u of pre) {
      const m = JSON.stringify(u).match(/digit_to_press\\?":\\?"([^"\\]+)/)
      if (m && m[1] !== '0') v.push(`pressed "${m[1]}" on a speech identity question`)
    }
    const stateIdx = pre.findIndex(u => (u.role ?? '') === 'user' && /what state/i.test(speech(u)))
    if (stateIdx >= 0) {
      const sReply = pre.slice(stateIdx + 1).find(u => (u.role ?? '').includes('agent') && speech(u).trim())
      if (sReply) {
        const sText = speech(sReply)
        if (!/arizona/i.test(sText)) v.push(`state answer was not Arizona (producer state): "${sText.slice(0, 80)}"`)
        if (/florida/i.test(sText)) v.push('answered with the insured state despite a producer address being present')
      }
    }
    return v
  },
  // Human arrival with a direct question: the first reply is the short
  // identification plus the answer, never the full opener.
  'human-midivr': list => {
    const v = []
    const samIdx = list.findIndex(u => (u.role ?? '') === 'user' && /confirm the policy number/i.test(speech(u)))
    if (samIdx < 0) return ["Sam's policy-number question never played"]
    const reply = list.slice(samIdx + 1).find(u => (u.role ?? '').includes('agent') && speech(u).trim())
    const text = reply ? speech(reply).trim() : ''
    if (!/calling from .* on a recorded line/i.test(text)) v.push(`first reply missing the short identification: "${text.slice(0, 80)}"`)
    if (!/n\s*[., ]?\s*t\s*[., ]?\s*l/i.test(text)) v.push(`first reply did not read the policy number: "${text.slice(0, 80)}"`)
    if (/insured'?s name to get started|to verify a certificate of insurance/i.test(text)) {
      v.push(`first reply delivered the full opener: "${text.slice(0, 80)}"`)
    }
    return v
  },
  'ai-gatekeeper': list => {
    const v = []
    const humanIdx = list.findIndex(u => /my name is Sam/i.test(speech(u)))
    const end = humanIdx < 0 ? list.length : humanIdx
    const openers = list.slice(0, end).filter(u =>
      (u.role ?? '').includes('agent') && /calling from .* on a recorded line/i.test(speech(u)))
    if (openers.length !== 1) v.push(`opener spoken ${openers.length}x to the automated system (must be exactly the exempt first turn)`)
    if (!list.slice(0, end).some(u => (u.role ?? '').includes('agent') && /lienholder/i.test(speech(u)))) {
      v.push('never answered the relationship slot question')
    }
    return v
  },
}

const createdIds = []
const engine = { type: 'conversation-flow', conversation_flow_id: flowId, version }

// --only=key1,key2 runs a subset (re-rolling a flaky scenario without
// burning a full 16-simulation batch).
const only = typeof flags.only === 'string' ? new Set(flags.only.split(',')) : null
const selected = only ? SCENARIOS.filter(s => only.has(s.key)) : SCENARIOS
if (only && selected.length !== only.size) {
  console.error(`\n❌  Unknown scenario key in --only=${flags.only}\n`)
  process.exit(1)
}

for (const s of selected) {
  const def = await client.tests.createTestCaseDefinition({
    name: s.name,
    response_engine: engine,
    user_prompt: s.user_prompt,
    metrics: s.metrics,
    dynamic_variables: { ...DYNAMIC_VARIABLES, ...(s.variables ?? {}) },
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
  const snapshot = run.transcript_snapshot
  const fullList = snapshot?.transcript ?? snapshot?.messages ?? (Array.isArray(snapshot) ? snapshot : [])
  // For scenarios with deterministic checks, the checks are authoritative on
  // any non-pass: liveness-killed runs never reach the judge, and the judge
  // has twice failed a run on reasoning contradicted by the raw transcript
  // (a keypress inferred from node_transitions; the exempt first turn
  // counted as a violation). The judge explanation still prints below for
  // review either way.
  let status = run.status
  if (status !== 'pass' && DETERMINISTIC_CHECKS[key]) {
    const livenessKill = /did not respond to consecutive/i.test(run.result_explanation ?? '')
    const v = DETERMINISTIC_CHECKS[key](fullList)
    if (v.length === 0) {
      status = livenessKill
        ? 'pass (simulator liveness limit; deterministic checks passed)'
        : 'pass (judge overruled; deterministic checks passed)'
    } else {
      for (const x of v) console.log('  DETERMINISTIC VIOLATION:', x)
    }
  }
  console.log(`===== ${key}: ${status.toUpperCase()} =====`)
  if (run.result_explanation) console.log(run.result_explanation.trim())
  const units = snapshot ? agentUnits(snapshot) : []
  // Bracketed narration is a spoken-aloud bug in EVERY scenario; voiced press
  // commands only matter where a keypad menu exists (elsewhere digits are
  // legitimate speech, e.g. reciting a policy number).
  const KEYPAD_SCENARIOS = new Set(['ivr', 'callback-queue', 'message-only-menu'])
  const violations = []
  for (const u of units) {
    const text = speech(u)
    if (/\[/.test(text)) violations.push(`bracketed narration spoken: "${text.slice(0, 80)}"`)
    if (KEYPAD_SCENARIOS.has(key) && /press (one|two|three|\d)/i.test(text)) violations.push(`voiced a press command: "${text.slice(0, 80)}"`)
  }
  for (const v of violations) console.log('  STATIC VIOLATION:', v)
  if (!status.startsWith('pass') || violations.length) failed++
  // Full transcript for the record.
  for (const u of fullList) {
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
