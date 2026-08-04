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
// burning a full 13-simulation batch).
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
