---
name: fordra-voice-agent
description: Retell voice-agent implementation map, tuning history, known issues, and remedies. Use BEFORE debugging any AI call problem (interruptions, talk-over, clipped questions, garbled transcripts, wrong agent behavior on calls) and BEFORE changing Retell agent settings, flow nodes, or publishing a new agent version. Each issue is symptom -> cause -> remedy, so call problems are recognized instead of re-diagnosed from scratch.
---

# Fordra voice agent (Retell) — implementation notes and known issues

The AI call feature dials insurance offices to verify COIs. This file is the
voice-agent counterpart of `fordra-repeat-bugs`: check it before debugging a
call or touching Retell config. When a NEW call problem is diagnosed or a
setting is retuned, append/update an entry here in the same format.

## Implementation map

- **Agent:** `RETELL_AGENT_ID` in `.env.local` (currently `agent_e581fdc4114615fa088b0690ec`),
  conversation-flow response engine (`conversation_flow_283618e37c0c`). Agent
  version N always pins flow version N (they branch in lockstep).
- **Repo touchpoints:** payload builder + validation `lib/call-config.ts`
  (variable names there are the single source of truth for the flow's
  `{{variables}}`); dispatch/stop `lib/retell.ts` via
  `app/admin/(console)/[id]/call/actions.ts` (admin-only); records in `ai_calls`
  (service-role only); webhook `app/api/retell/webhook`.
- **Operator scripts:** `scripts/retell-publish-agent.mjs` (publish),
  `scripts/retell-list-calls.mjs` (recent calls), `scripts/retell-test-ivr.mjs`
  (flow test against a fake IVR). All Retell traffic goes through `retell-sdk`,
  NEVER raw fetch (deprecated paths email the workspace owner).
- **Editing a published agent/flow:** `agent.update` / `conversationFlow.update`
  refuse published versions. First `client.agent.createVersion(agentId,
  { base_version: N })` — mints agent draft N+1 and auto-branches the flow to
  draft N+1, already pinned. Then update flow and agent with explicit
  `version: N+1`, dry-run publish, publish, and re-retrieve the LIVE agent to
  confirm settings + flow pin + node texts (the triple-check rule).
- **Voicemail is handled in TWO places:** agent-level `voicemail_option`
  (Retell answering-machine detection + its own spoken text + detection_prompt,
  fires disposition `voicemail_reached`) and the flow's NVM node
  (`node-ivr-vm`, for the IVR navigation path). Copy or behavior changes must
  cover both — see issues 7-8.
- **Opener design (v19/v20, owner wording 2026-08-03):** the N1 opener names
  only {{on_behalf_of}} and offers the INSURED'S NAME as the lookup hook ("Do
  you need the insured's name to get started?"). Never reintroduce the
  assistant name, the insured name, or the policy number into the opener: reps
  look up by insured name/VIN, and a policy number is useless on fleet
  policies (McGriff feedback). Owner-scripted post-opener exchange (N4c rule
  0): yes → "The insured name is {{insured_name}}. Anything else you need to
  find the policy?"; bare "yes" back → wait silently; other detail → give it
  plus the same follow-up. N1q routes agreement to N4c. Refusals anywhere go
  through N6b's channel ask ("Got it, what's the best way to get a certificate
  verified with your office?") before N9b.
- **Test harness:** `scripts/retell-test-ivr.mjs` runs six scenarios rebuilt
  from real calls (Colstan keypad IVR, human, already-verified, Avant callback
  queue, Farm Bureau message-only menu, Progressive-style AI gatekeeper).
  Silence-heavy scenarios trip the simulator's liveness kill when the agent is
  CORRECTLY silent; the harness then falls back to deterministic transcript
  checks. Run it against every draft before publish.
- **Diagnosing a call:** `client.call.retrieve(callId)` gives `latency`
  (e2e/llm/tts/asr percentiles) and `transcript_object` with per-word
  timestamps — overlapping start/end times show exactly who talked over whom.
  Post-call extraction lands in `call_analysis.custom_analysis_data`.

## Settings history

| Date (agent ver) | responsiveness | interruption_sensitivity | Why |
|---|---|---|---|
| through v16 | 0.8 | 0.45 | initial defaults |
| 2026-07-29 (v17) | 1.0 | 0.7 | VRF 1095 talk-over fixes (see issue 1) |
| 2026-07-29 (v18) | 1.0 | 0.7 | voicemail fixes only (see issues 7-8), voice settings unchanged |
| 2026-08-03 (v19) | 1.0 | 0.7 | opener v2 + verbosity pass + transcript-audit fixes (issues 9-11), voice settings unchanged |
| 2026-08-03 (v20) | 1.0 | 0.7 | owner corrections: callback number reverted, insured-name exchange, refusal channel-ask (N6b), IVR hardening (issue 12), voice settings unchanged |

Unchanged: voice `retell-Sloane`, backchannel on at 0.6 ("mm-hmm", "okay"),
`stt_mode: accurate`, noise-cancellation denoising.

## 1. Talk-over / interruptions on calls (VRF 1095, 2026-07-29)

**Symptom:** transcript shows double-talk — agent utterances split into
fragments, rep restarting sentences, orphaned words like a lone "Is".

**Cause (measured on call_040c9390a055213e6784c6f148d):** end-to-end response
latency ~1.9s median / 2.9s max. Reps expect ~0.5s gaps, so they refill the
silence right as agent audio lands. Once overlapped, low interruption
sensitivity (0.45) made the agent keep talking ~2s before yielding. Scripted
ack-then-pause lines ("Ok." / "Thank you." before a question) invited the
barge-in.

**Remedy (shipped in v17):** responsiveness 1.0, interruption_sensitivity 0.7,
flow copy de-acked (N6 email question lost its "Ok." prefix; gate node forbids
standalone acks before questions). Healthy target on future transcripts: agent
replies ~1.2-1.6s after the rep stops, no overlap longer than ~1s.

## 2. OPEN TRADEOFF — sensitivity 0.7 may clip questions

**Symptom to watch for:** agent questions cut off mid-sentence when the rep
backchannels ("yeah yeah", "okay") while the agent is still talking; transcript
shows the agent re-asking or questions ending abruptly with no rep barge-in
intent.

**Cause:** interruption_sensitivity 0.7 (raised 2026-07-29) makes the agent
yield fast; a chatty rep's backchannels can now register as interruptions.

**Remedy if it bites:** drop interruption_sensitivity to 0.6 (keep
responsiveness at 1.0 — it is not part of this tradeoff). If clipping persists
at 0.6, revisit `backchannel_frequency` (0.6) too: the agent's own backchannels
during rep speech can also confuse turn-taking. Retune via a fresh draft
(createVersion), never the dashboard.

## 3. Latency floor is structural, ~1.2-1.6s

**Symptom:** even after v17, gaps before agent replies stay noticeably longer
than human (~0.5s).

**Cause:** the stack itself — turn detection + LLM (p50 ~540ms) + TTS
(~240ms) + telephony. responsiveness 1.0 is already the max of the cheap lever.

**Remedy if it matters:** `stt_mode: 'fast'` (trades transcription accuracy —
risky for spelled-out emails/policy numbers), a faster LLM on the flow nodes,
or accepting the floor. Measure first via `call.latency` before changing
anything.

## 4. Front desk refuses to help a first-name-only caller

**Symptom:** rep demands a full name and stalls the call (Progressive,
2026-07-28).

**Cause:** opener introduces the agent by first name only (by design).

**Remedy (in place):** `assistant_last_name` is a required dispatch field
(`lib/call-config.ts` REQUIRED_FIELDS); the agent gives the full name only when
asked. Do not add the last name to the opener.

## 5. Rep asks "what do you want to verify?" and gets a non-answer

**Symptom:** early in the call the rep asks what we want; agent responds with
the account-lookup question; rep re-explains, conversation stalls.

**Cause:** flow routed opener follow-ups into N4c whose fallback line is "What
do you need from me to locate the account?".

**Remedy (shipped in flow v17):** N4c answers directly — "I just have a few
quick questions about a certificate of insurance issued for {{insured_name}}."
— then continues the lookup. If other non-answer loops appear, fix the node's
prompt, not the opener.

## 6. Spelled-out emails garbled in the raw transcript

**Symptom:** ASR mangles letter-by-letter dictation ("search c e r t s ... at
a a zone dot net"), making the raw transcript ambiguous.

**Status:** mitigated — Retell's post-call analysis extracts the email
correctly into `call_analysis.custom_analysis_data`; read it from there, not
from the transcript. If a future call gets one wrong, add a read-back
confirmation step to N6 (new spoken copy — needs Jullian's wording approval).

## 7. Live human answered, agent left a voicemail message and hung up

**Symptom:** a person answers ("Hello, this is [name] with [company]"), the
agent responds with the we'll-try-again voicemail message and disconnects;
disposition `voicemail_reached` (McGriff call_75d89e6221ddc7faae421911fc2,
2026-07-29).

**Cause:** Retell's agent-level answering-machine detection (`voicemail_option`)
runs in the first ~3 minutes. This number sat behind ~45s of ring/dead air, and
an earlier call that day genuinely hit voicemail there — long non-speech audio
followed by a name-and-company greeting is exactly the voicemail signature, so
AMD fired on the live human. (The agent had not spoken yet either: it waits for
the callee's first utterance, so 43s of silence preceded her "Hello".)

**Remedy (shipped in v18):** `voicemail_option.detection_prompt` now defines
voicemail narrowly — recordings and beeps only; a live person greeting with a
name/company and pausing for a reply is NOT voicemail; ringing, silence, hold
music, and IVR menus are NOT voicemail; when unsure, assume live person. If a
false positive recurs, next steps: shorten `voicemail_detection_timeout_ms`
(genuine voicemail on slow lines still greets by ~45-55s, so ~90s is safe), or
disable AMD entirely (`voicemail_option: null`) and rely on the flow's NVM
node — but that loses the `voicemail_reached` disposition the app maps to the
"Voicemail" outcome label (`lib/ai-call-shared.ts` dispositionLabel), so the
webhook/outcome path would need a replacement signal (`call_analysis.in_voicemail`).

## 8. "Digital assistant" spoken unprompted (copy lives OUTSIDE the flow too)

**Symptom:** the agent says "digital assistant" without the callee pressing on
identity — e.g. in a voicemail message or to a call-screening system — despite
the flow nodes being scrubbed.

**Cause:** spoken copy is not only in flow nodes. Agent-level fields speak too:
`voicemail_option.action.text` (AMD's message) and
`call_screening_option.call_purpose` (spoken to screening systems). Both
carried pre-2026-07-28 wording after the flow was scrubbed.

**Remedy (shipped in v18):** both fields de-scrubbed; the voicemail text now
matches the approved NVM node copy ("Hi, this is {{assistant_name}} calling
from {{on_behalf_of}}..."). The flow global_prompt also gained a guard: the
digital-assistant wording is spoken ONLY in the fixed who-are-you answers (G1,
N1q, global-prompt script) — the sanctioned mentions. **Checklist for any
future identity/copy change:** sweep EVERY string field on the agent object AND
every flow node text + global_prompt (scan recursively; don't grep the flow
alone), and re-sweep the LIVE version after publishing.

## 9. Generic voicemails caused un-actionable "call storms"

**Symptom:** an office received ~6 calls over a few days; every voicemail was
"calling to verify a certificate" with no way to tell which certificate or to
call back (direct rep feedback: Susan Murphy, McGriff, 2026-07-30 callback —
"the problem is when I call back, it's like, which one was it?").

**Cause:** the NVM/voicemail_option text named the insured but left NO
callback number, and repeat attempts left near-identical messages.

**Remedy (v19, REVERTED in v20 by owner decision):** v19 added a spoken
callback number; the owner reverted it same-day — **inbound calling is out of
scope, do NOT reintroduce a callback number or a `callback_number` variable.**
The v20 voicemail names {{on_behalf_of}} and {{insured_name}} only, which
covers the which-certificate half of the feedback; the no-way-to-call-back
half is accepted as a known limitation until inbound is in scope. Any
voicemail copy change must keep NVM and `voicemail_option.action.text`
byte-identical (see the map note above and issue 8).

## 10. "We already verified that" ended the call in 24 seconds

**Symptom:** rep answered the opener with "I've already done that"; the agent
went straight to the unable-to-proceed goodbye (Cornerstone,
2026-07-28, 24s call, nothing verified).

**Cause:** every negative-shaped reply routed to N9b; no recovery path
existed for already-done claims.

**Remedy (shipped v19, wording + routing updated v20):** new node `node-n1r`
makes exactly ONE scripted recovery attempt ("Understood. This is just a
quick re-confirmation for our records. Can we run through it?"), reachable
from N1/N1es/N1q/N4b/N4bes/N4c. The negative edges on those nodes carry an
explicit "Not when they say it was already verified" exclusion —
load-bearing; do not remove it when editing those edge conditions. A second
decline goes to N6b's channel ask, then N9b. Test scenario `already-verified`
in `scripts/retell-test-ivr.mjs` covers it.

## 11. Callback-queue IVR left the call dangling until hangup

**Symptom:** a hold queue offered "press one to save your place in line /
confirm your callback number"; the agent sat mute through the prompts until
the system gave up (Avant, 2026-07-30, disposition user_hangup).

**Cause:** the IVR cluster had no rule for callback offers: pressing digits
is normally always right on a keypad menu, so neither pressing nor ignoring
was clearly correct and the agent froze.

**Remedy (shipped v19):** navigator rule 7a + carve-outs in both press_digit
nodes and their trigger conditions: ignore optional callback/save-your-place
offers, stay in the queue (staying on the line beats a callback), never
confirm or provide a number for an automated callback; if a callback flow
blocks progress, choose voicemail if offered, otherwise end. The carve-out
wording is scoped so the Colstan closed-office menu (pressing category
digits toward voicemail) still passes — if the `ivr` test scenario ever
regresses, restore the carve-out, do not relax navigator rule 0.

## 12. Conversational AI gatekeepers: opener re-delivered, narration, spurious presses

**Symptom (all three seen in v20 simulations, matching the live Progressive
call 2026-07-28):** (a) the full opener re-delivered to a carrier's AI
assistant when it read a number back; (b) "[Staying silent while on hold...]"
spoken aloud during a hold; (c) a digit pressed while a system said "say or
enter the policy number".

**Cause:** (a) the press_digit nodes' back-to-opener edges said only "a live
person has come on the line" — a conversational bot's read-back qualified
(the navigator's own human edge already had the strict wording, the press
nodes did not); (b) the LLM emits stage directions when it has nothing to
say, and TTS speaks them; (c) "say or enter" matched the keypad-menu trigger.

**Remedy (shipped v20):** strict no-AI wording copied onto BOTH press nodes'
human edges; navigator instruction: when there is nothing to say, output
NOTHING — never bracketed text or descriptions of waiting; navigator global
condition triggers immediately on scripted slot-question bots (relationship,
say-or-enter, "complete sentences") even at call start; press-node conditions
never trigger on say-or-enter prompts. Covered by the `ai-gatekeeper` and
`callback-queue` scenarios; the harness's bracketed-narration scan runs on
every scenario.

## Standing rules for any change here

- New spoken lines are user-facing copy: show Jullian the exact wording first.
- Flow `{{variable}}` renames require the same rename in `lib/call-config.ts`
  (`buildDynamicVariables`) in the same change.
- After every publish: re-retrieve the live agent and confirm version,
  settings, flow pin, and edited node texts. Update the settings-history table
  above when tuning values change.
