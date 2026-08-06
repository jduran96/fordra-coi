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
- **Reference details prefill** (`draftFromVerification` in
  `lib/call-config.ts`): org rows, then per-deal computed rows — policy
  numbers, addresses, certificate holder, vehicle descriptions
  (year/make/model from template variables/requirement rows, issue 17),
  VINs, USDOT/MC. Insurers verify by vehicle: keep the vehicle description
  row next to its VIN.
- **Test harness:** `scripts/retell-test-ivr.mjs` runs twenty-four scenarios
  rebuilt from real calls (Colstan keypad IVR, human, already-verified, Avant
  callback queue, Farm Bureau message-only menu, Progressive-style AI
  gatekeeper, the VRF-1110/1111/1112 hold/patience/deflection cases,
  the VRF-1113/1114 qualified-menu / lookup-escalate / auth-wall /
  human-arrival cases, plus the VRF-1119 transfer-greeting /
  bilingual-aside / volunteered-answers cases — see the file header for
  the full list).
  Silence-heavy scenarios trip the simulator's liveness kill when the agent is
  CORRECTLY silent; the harness then falls back to deterministic transcript
  checks. Run it against every draft before publish.
- **Diagnosing a call:** `client.call.retrieve(callId)` gives `latency`
  (e2e/llm/tts/asr percentiles) and `transcript_object` with per-word
  timestamps — overlapping start/end times show exactly who talked over whom.
  Post-call extraction lands in `call_analysis.custom_analysis_data`.
  Since 2026-08-04, `transcript_with_tool_calls` is also persisted to
  `ai_calls.transcript_detail` (jsonb; lazy-backfilled by the admin status
  route) and rendered structured in the admin console (`TranscriptView`,
  formatter `lib/call-transcript.ts`) — the flat `transcript` string stays
  for extraction and is low-fidelity (interleaved overlap, no DTMF/holds).

## Settings history

| Date (agent ver) | responsiveness | interruption_sensitivity | Why |
|---|---|---|---|
| through v16 | 0.8 | 0.45 | initial defaults |
| 2026-07-29 (v17) | 1.0 | 0.7 | VRF 1095 talk-over fixes (see issue 1) |
| 2026-07-29 (v18) | 1.0 | 0.7 | voicemail fixes only (see issues 7-8), voice settings unchanged |
| 2026-08-03 (v19) | 1.0 | 0.7 | opener v2 + verbosity pass + transcript-audit fixes (issues 9-11), voice settings unchanged |
| 2026-08-03 (v20) | 1.0 | 0.7 | owner corrections: callback number reverted, insured-name exchange, refusal channel-ask (N6b), IVR hardening (issue 12), voice settings unchanged |
| 2026-08-04 (v21) | 1.0 | 0.7 | VRF-1110 fixes (issues 13-15): live-rep hold rule, answer-pacing rules, IVR call-start hardening, conditional follow-up rule; `reminder_trigger_ms` 30000 → 45000 |
| 2026-08-04 (v22) | 1.0 | 0.7 | settings-only (flow byte-identical to v21): `reminder_trigger_ms` 45000 → 60000 — owner call after VRF-1111 showed real holds run past 45s and the reminder cannot be exercised in the simulator |
| 2026-08-04 (v23) | 1.0 | 0.7 | VRF-1111 fixes (issue 16): transfer ack once per transfer, thinking-aloud patience, hold-noise silence; voice settings unchanged |
| 2026-08-04 (v24) | 1.0 | 0.7 | VRF-1112 fixes (issue 17): gate/N5 miss branch for details not in the list, dead-end routes to N6b channel ask; voice settings unchanged |
| 2026-08-04 (v25) | 1.0 | 0.7 | VRF-1112 second call, fixes (issue 18): request-handling hoisted above gate/N5 headline job, mid-hold-question exception inline in the hold rule (gate/N5/N4c); voice settings unchanged |
| 2026-08-05 (v26) | 1.0 | 0.7 | VRF-1113/1114 IVR fixes (issues 19-20): two-pass keypad selection, retry-then-escalate on failed lookups, DOB-wall agent ask, partial-identifier + producer-state answers, new node-n1h human-arrival answer-first; voice settings unchanged |
| 2026-08-05 (v27) | 1.0 | 0.7 | VRF-1113 third call, fixes (issue 21): n1h repeat-only-the-value, strong-identifier not-found confirm-then-goodbye (N4c/gate + broadened NW edges), `not_found_identifier` post-call field; voice settings unchanged |
| 2026-08-06 (v28) | 1.0 | **0.6** | VRF-1119 fixes (issue 22): the issue-2 clipping tradeoff finally bit (noise cut the same question twice), so sensitivity dropped per that plan; plus router start node, language lock, already-answered rules |
| 2026-08-06 (v29) | 1.0 | 0.6 | flow-only, VRF-1114 second call (issue 23): gate→N5 fires the moment blockers resolve (idle wrap-up killed nine questions), identity questions routed to G1 not G2 |

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

**It bit (VRF-1119, 2026-08-06):** background noise — not rep speech; per-word
timestamps showed zero overlap — clipped "The last four digits" mid-sentence
TWICE in a row, and the digits never came out. Sensitivity dropped to 0.6 in
v28 per the plan above. Next lever if it recurs: backchannel_frequency.

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
Harness note (2026-08-04): the simulator's LLM judge once failed this
scenario by inferring a keypress from `node_transition` entries alone (no
press_digit tool call existed); the metric now tells the judge that only
explicit press_digit invocations count. If a scenario fails on judge
reasoning that contradicts the raw transcript, check for that artifact
before touching the flow.

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

## 13. Live rep says "give me a second" — agent kept firing questions

**Symptom (VRF-1110, call_2ae55580c7e18aa6944e1fd2692, 2026-08-04, v20):**
rep said "Give me one second, please, I verify this information"; 6s later
the agent asked the NEXT question, the 30s reminder nudged mid-check, and
when she returned (~110s later) it re-asked a question she was answering.
Repeated twice more in the same call; once it skipped the pending question.

**Cause:** global-prompt rule 8 (stay silent on hold) exists, but the Gate
and N5 node prompts dominate each turn and had a wait rule ONLY for
transfers; nothing covered "let me check". The agent-level
`reminder_trigger_ms: 30000` fired regardless.

**Remedy (shipped v21):** explicit hold rule on node-gate, node-n5, AND
node-n4c — cues include "give me a second", "let me check", "let me check
on that", bare "checking", "one moment", "hold on" (owner-broadened
2026-08-04); on any of them say only "Of course." then full silence ("Of
course." is the ENTIRE turn; a still-checking update gets NOTHING, not
"Understood"); no new question, no re-ask, no check-in; on return resume
the pending question (or accept the answer given). `reminder_trigger_ms`
raised to 45000 (`reminder_max_count` stays 1); v22 raised it to 60000
(see the settings table) since real holds can outlast 45s. Test scenario
`hold-live-rep` (deterministic fallback: the correct behavior is silent
turns, which trips the simulator's liveness kill). The exact-silence
wording took three iterations — the LLM pads acknowledgments unless told
the ack is the entire turn and never repeats. It then emitted a literal
"[No response.]" placeholder on silent turns (issue 12 through a new
door), so every silence-required node (gate/N5/N4c hold rule, navigator,
both press nodes) carries an explicit "never emit placeholder text such
as [No response.] - an empty output is the correct response" clause.
Reuse that clause verbatim anywhere silence is added.

## 14. Barreling past partial/list answers

**Symptom (same VRF-1110 call):** "Who are all the insured parties?" — rep
gave ONE name, agent moved on 1.1s later without "anyone else?". "Year,
make, and model?" — rep said only "two thousand twenty four", agent moved on.

**Cause:** N5 rule 4 covers replies that don't answer the question at all;
nothing covered partially-answered or list questions, and rule 5 ("take
answers as given and move on") won.

**Remedy (shipped v21):** N5 gets a GENERIC patience rule only — give
people time to finish, never treat the first words as the whole answer,
and ask for the missing part of a multi-part question. Question-specific
re-asks ("Is that everyone listed?") are NOT prompt text by owner decision
(2026-08-04, "let admin decide what needs reasking"): configure them as
per-question follow-ups (issue 15), e.g. condition "they name only one
party" → "Is that everyone listed on the certificate?". Do NOT touch
responsiveness/interruption_sensitivity for this (see issues 1-2). Test
scenario `partial-answer` (its question list carries the configured
follow-up).

## 15. Conditional follow-up questions are DATA, not prompt text

The admin can attach `followUp: {condition, text}` to any question
(per-deal AI-tab editor and org-level settings Questions List;
`lib/call-config.ts` AiCallQuestion). `renderQuestions` emits it as an
indented `- Follow-up (only if: <condition>): <text>` line, and ONE generic
rule on node-gate + node-n5 (shipped v21) interprets all of them: never read
the line with the main question, ask it as its own question only when the
answer matches the condition, never repeat. New follow-ups need NO flow
change. Keep the rendered wording and the flow rule in sync if either
changes. Test scenarios `conditional-followup` / `conditional-followup-no`.
First use: the NTL/Bobtail + operator-primary-coverage combo question is now
split into main + follow-up instead of one confusing mega-question.

**Also fixed in v21 (extends issue 12):** the opener was spoken over a
"For English, press one" menu at call start (VRF-1110: pressed 1 only on the
menu's third replay). Both `node-ivr-press` and `node-ivr` global conditions
now say to trigger even on the very first thing heard, BEFORE any opening
line is spoken — a keypad menu answer means keypress first, opener never.

## 16. One-line interjections re-triggered rules meant to fire once (VRF-1111)

**Symptom (NASTC call, 2026-08-04, agent v21):** three flavors of the same
failure — the agent answered every callee turn, including turns that
deserved silence: (a) James said "I'm gonna send you to Michelle" → agent
"Thank you." → James's stray "Yes," → agent "Thank you." AGAIN; (b) rep
exclaimed "Oh my goodness." at a list question, paused 3s, and the agent's
re-ask (rule 2, reply-doesn't-answer) landed exactly as she resumed with
"It is..." — cut her off; (c) during a lookup hold, a burst of
unintelligible audio drew a SECOND "Of course.".

**Cause:** the transfer, re-ask, and hold-acknowledgment rules were written
per-trigger, not per-episode — every callee utterance is a fresh turn, so a
fragment, exclamation, or noise re-matched the rule. Nothing distinguished
"speech addressed to the agent" from noise/asides.

**Remedy (shipped v23, six flow iterations):** a compact SILENCE CHECK
block at the very TOP of gate/N5/N4c (exclamations and false starts,
mumbles/noise, anything during a hold after the single "Of course.",
anything during a transfer after the single "Thank you." → output
nothing; never describe waiting); the hold rule rebuilt with the
once-guard AT THE TRIGGER sentence; transfer-ack-once on gate/N5/N4c AND
**node-n4** (N1's transfer edge routes there — the first run failed
because n4's own "say Thank you" rule was missed; sweep every node that
speaks an acknowledgment) with an explicit boundary: the transfer is
OVER the moment a new person greets you (without it the agent muted the
new person's greeting too); the exclamation exception INLINE in the
re-ask rules it overrides; and an N4c guard (never announce completion
or wrap up from the lookup step — a sim run had the agent say "That's
all I need for now" before any question was asked).

Placement lessons (gpt-4.1 nodes, ~5k-char instructions): a limit stated
below its trigger loses to the trigger re-firing on every fragment — put
the once-per-episode cap in the trigger sentence itself; an exception to
a rule must sit inline in that rule, not in a tail paragraph; when rules
still lose mid-prompt, hoist a compact decision block to the TOP of the
instruction (primacy beats one more mid-list rule).

Harness lessons: test scenarios `transfer-fragment` / `thinking` /
`hold-noise` rebuild the NASTC call as THREE scenarios with ONE silent
beat each — the simulator kills a conversation-node run at the first
empty-output turn it dislikes, so a scenario with two silent beats can
never reach its second one. `hold-live-rep`'s deterministic check now
also fails a repeated "Of course.". Deterministic checks are now
authoritative over a failing judge (two judge false positives observed:
a keypress inferred from node_transitions, the exempt first turn counted
as a violation); the `ivr` check only counts speech that directly
follows a menu-like utterance, because the sim sometimes hallucinates a
live human mid-menu and answering that is correct. `--only=key1,key2`
re-rolls a subset without burning a full batch.

## 17. Rep asked for a detail the agent lacked; agent deflected with its own question (VRF-1112)

**Symptom (Progressive, 2026-08-04, agent v23):** commercial-lines rep asked
to "verify year, make, model, last four of the VIN." The agent gave the VIN
last-4 (correct), but when pressed for the **make** it answered with its own
gate question ("Is this COI currently active?"). The rep refused twice ("I
need additional information for verification") and the call ended with
nothing verified.

**Cause (two halves):** (a) the deal HAD the vehicle description — template
variable `vehicle_listed = "2019 International 4300"` — but
`draftFromVerification` only extracted VINs into reference details, so the
agent never received it (and the requirements parser rewrites row values
into prose notes, so the normalized rows are not a recoverable source; the
provenance variables are). (b) Gate and N5 rule 0 covered only requests for
details that ARE in the reference list; N4c's "I don't have that in front
of me" rule had no counterpart there, so an unmatched request fell through
to the node's default job: ask the next question.

**Remedy (app + flow v24, 2026-08-04):**
- `lib/call-config.ts`: `collectVehicleDescriptions()` adds vehicle
  year/make/model rows from resolved template variables + requirement rows
  (submitted standards only, VRF-1083 rule); the admin page now passes
  `templateVariables` into `draftFromVerification`. `isIdentifier` also
  tightened to single-token values — multi-word values (vehicle
  descriptions, addresses) were getting last-four/spoken hints and would
  have been recited letter by letter.
- Flow v24: gate + N5 rule 0 gained the miss branch — "I don't have that in
  front of me." then "Is there anything else I could give you instead?",
  with an explicit NEVER-answer-an-information-request-with-your-own-
  question clause (inline in rule 0 per the issue-16 placement lessons).
  Gate's and N4c's N6b refusal edges extended to cover "cannot verify
  without information you do not have" (a blocked-but-willing rep is not a
  "refusal", so the old wording never fired — the first sim run had the
  agent wrap up with "My team will follow up" and DECLINE the rep's own
  offer of a better channel); N5 gained its own N6b edge with that
  condition (it had none). A dead end in any of the three nodes now lands
  on the channel ask instead of more questions. N4c's already-verified
  exclusion kept (issue 10).
- Test scenario `missing-detail` (Progressive-style rep demands a license
  plate number, which is never in the details): deterministic check asserts
  the miss line, no deflection, and the channel ask after the dead end.

## 18. Rep questions still deflected on v24: node-entry swallow + mid-hold questions (VRF-1112, second call)

**Symptom (Progressive, 2026-08-04 21:00, `call_43cd1c1f9263a8d32e544b70bc8`,
agent v24 — the same evening the issue-17 fix shipped):** the call succeeded
overall, but the barrelling recurred twice: (a) the rep said "I have the
policy. I need you to verify the last four of the VIN" and got TWO gate
questions plus a misfired N6b channel ask before the agent finally read back
"1 4 0 0" on her third ask; (b) later, mid-hold ("Bear with me, my document
system is loading"), she asked "What date is listed on the certificate?" and
got silence twice, then the pending gate question TWICE, before the miss line
fired on her fourth ask.

**Cause (two independent gaps that issue 17's rule-0 clause loses to):**
(a) her request arrived in the same utterance that satisfied N4c's
policy-found edge to node-gate; on node entry, gate's headline job ("Ask
these blocker questions first") sits above rule 0 and won the first two
turns — the transition swallowed the outstanding request (the issue-16
placement lesson again: below-the-fold rules lose to the headline job). The
N6b hop was collateral: "can't answer until verification" matched the v24
cannot-verify-without-information edge. (b) the hold rule says a hold ends
ONLY on substantive information, and on return "otherwise restate the
pending question" — a mid-hold question is neither info nor an answer, so
the agent obeyed the hold rule literally; the never-deflect clause lived in
rule 0, not inline in the hold rule it needed to override.

**Remedy (flow v25, 2026-08-04):**
- gate + N5: a hoisted block right after the SILENCE CHECK — "FIRST, before
  any question of yours: if their latest utterance asks YOU for information
  — including the very utterance that brought the call to this step — handle
  it under rule 0 below." N4c deliberately NOT hoisted: answering requests
  already IS its headline job.
- gate + N5 + N4c hold rule, inline at its trigger sentences: a hold also
  ends when they ask you a question, and "if they ask you a question, answer
  it under rule 0 / like any detail request — NEVER restate the pending
  question as a reply to a question they asked you".
- No new spoken copy (reuses the rule-0 detail read-outs, the v24 miss line,
  "Of course."), no settings changes.
- Test scenarios `verify-readback` (read-back demand for a detail the agent
  HAS, fused with the policy-found utterance) and `hold-question` (mid-hold
  question for a detail NOT in the list), both with deterministic checks on
  the first reply after the request.

## 19. GEICO IVR could not parse the policy number: spoken "dash" (VRF-1113)

**Symptom (GEICO commercial line, 2026-08-05, `call_456a6a87aa5f61895917d5df2aa`,
agent v25):** the IVR asked for a policy number; the agent read
"9 3 0 0 3 5 7 0 3 8 dash 0 0"; GEICO's recognizer failed twice ("Sorry I
didn't catch that"), demanded keypad-only entry, and the call funneled into a
policyholder date-of-birth authentication wall it could never pass. Dead end,
nothing verified.

**Cause:** `valueSpoken()` in `lib/call-config.ts` named punctuation — hyphens
became the literal word "dash" (slashes "slash") in the `reference_details`
spoken hints, and the agent recites those hints verbatim. IVR speech slots
expect digits only, and human reps only type the characters anyway.

**Remedy (app-only, shipped 2026-08-05, no flow change):** hyphens and slashes
are now silent run separators in `valueSpoken` — "9300357038-00" renders as
"9 3 0 0 3 5 7 0 3 8. 0 0". "." is still spoken as "dot" (load-bearing for
email/URL-shaped values). Hints are rendered at dispatch time, so the fix
applies to every call dispatched after deploy with no redraft needed.

**Follow-up (flow v26, 2026-08-05, after the retry call
`call_1159b4a1d7426272f9e5ab08b3e` read the number cleanly and GEICO still
failed — the owner then failed by voice too, so it is a lookup failure, not
pronunciation):**
- Navigator rule 4b: a speech slot that cannot catch/find a value from the
  reference details gets ONE re-read, then "speak to an agent" / press 0 —
  never a third read, never a dead-end while an agent path is untried.
- Auth-wall (old gap b): rule 4 now says exactly "I don't have that. Could
  I speak with an agent, please?" for DOB/SSN-style demands, instead of
  silent retries into the hangup. Rule 6 (loop exit) and both fail edges
  also require an agent ask before ending.
- Partial identifiers: give exactly the requested part (first digit/letter,
  last four) from the reference details.
- State questions: producer's state (Producer address row) first, insured's
  state as fallback — owner decision 2026-08-05. App side: `producer` +
  `producer_address` computed row kinds added to `lib/call-config.ts`
  (values from `coi.producer` / `coi.insurance_company_address`); saved
  drafts from before that deploy lack the rows until re-drafted.
- Human arrival mid-IVR: new node `node-n1h` — all three IVR nodes' live-
  person edges now land there instead of re-delivering the N1 opener. If
  the person opens with a direct question, the whole first turn is the
  owner-approved copy: "Hi, I'm calling from {{on_behalf_of}} on a
  recorded line. {answer}." then silence until they lead (reminder
  follow-up: the insured-name hook). A plain greeting gets the standard
  opener wording. (N1 stayed static_text through v27; SUPERSEDED in v28 —
  see issue 22: the static N1 is gone, and the start node speaks the
  opener conditionally with an exact-text guard.)

**Still open:** (a) no mechanism to enter a long identifier via keypad when
an IVR demands "using only your keypad" — the press nodes are built around
single menu digits; (b) RESOLVED in v28 — the begin→N1 first-turn race
(opener delivered to robots/recordings before the IVR global conditions
could fire) is closed by the router start node (issue 22). The
transcript's apparent talk-over on this call
was an artifact — per-word timestamps showed zero overlap; the agent spoke
into a 4s gap that the flat transcript renders as an interruption.

## 20. Menu qualifiers disqualified every option; agent hung up without pressing (VRF-1114)

**Symptom (TrueNorth, 2026-08-05, `call_23b50919247bfec32885b9e4911`,
agent v25):** menu offered "if you are a current client or have already
received your quote, press one for customer service; if you are in need of
a quote, press two." The agent — neither a client nor quote-shopping —
matched nothing, pressed NOTHING through three menu plays, then took the
keypad node's dead-end edge (whose condition literally required "digits
were pressed") and hung up at 56s. The opener had also been spoken over
the menu's second play (the begin→N1 gap, issue 19 still-open item b).

**Cause:** the press nodes' preference list named customer service but
nothing said a qualifier ("if you are a current client") does not
disqualify an option; and the fail edge fired despite its own
digits-were-pressed wording — an LLM edge condition is not a validator, so
the impossible branch needs to be unpickable by instruction, not just
false in fact.

**Remedy (shipped v26):** both press nodes rewritten as TWO PASSES — pass
1 purpose match (certificates / policy verification / commercial), pass 2
last resort ONLY when nothing fits: the option most likely to reach a
human soonest (customer service, operator, front desk). Explicit clause:
a qualifier NEVER disqualifies — judge options by where they LEAD, not who
the menu says they are for (owner logic 2026-08-05: never blanket-default
to customer service when a purpose match exists). Fail edges on both press
nodes and the navigator now forbid firing when no digit has been pressed
or while any digit is on offer, and require an agent ask before ending.
Navigator rule 2 mirrors the two-pass logic for spoken menus. Test
scenario `qualified-menu` (deterministic check: reaching Dana proves the
press was 1; menu speech after the exempt first turn is a violation).

## 21. Policy-not-found dragged through channel ask + follow-up logistics (VRF-1113, third call)

**Symptom (GEICO, 2026-08-05, `call_0772d18d72155e60ad858cae9a6`, agent
v26):** the call itself was v26's validation lap — escalation, DOB-wall
line, producer-state answer (Virginia, correct: GEICO's producer box is
Fredericksburg VA), and n1h all worked. Two rough edges: (a) the human
rep's "repeat that policy number" got the ENTIRE n1h first-turn shape
again, identification line included; (b) her "We do not have that policy
number here" routed to N6b's channel ask and then a how-should-we-follow-
up question, ending on the rep's useless "just call back" — when a
strong-identifier miss is itself the answer (owner rule: policy number
and VIN are sources of truth; an insured-name miss alone is weak).

**Cause:** (a) n1h prescribed the first-turn shape but had no repeat rule,
so a repeat request re-ran the whole shape. (b) N4c's NW edge covered only
"cannot find any record of the insured" — a policy-number miss fell
through to the cannot-verify edge (N6b). NW itself could not host a
confirming read-back either: NW and N9b end calls via
`skip_response_edge` → node-hangup, i.e. they speak and hang up WITHOUT
waiting for a reply — any question added there dies mid-air. Check for a
skip_response_edge before making a terminal node conversational.

**Remedy (v27, app + flow):**
- n1h: repeat requests repeat ONLY the value, from its spoken form.
- N4c rule 8 + gate NO-RECORD RULE: on a policy-number/VIN miss, confirm
  ONCE ("Just to confirm, you're showing no record under {identifier}?"),
  offer the other strong identifier if untried, then stop — no channel
  ask, no follow-up logistics; NW's existing terminal goodbye ("Thanks
  for checking. Goodbye.") fires via the broadened N4c/gate NW edges
  (condition now requires the confirming read-back to have happened).
  n1h routes no-record claims into N4c where the confirm rule lives.
- Post-call analysis: new enum `not_found_identifier`
  (none/insured_name/policy_number/vin/multiple). App: `callRedFlag()` in
  `lib/ai-call-shared.ts` shows "Policy not found" in red on the admin
  call tab + calls index when `claimed_no_record` is true with a strong
  identifier. The failed-verification verdict stays with the admin at
  publish — the flag is a signal, not an auto-fail (owner decision
  2026-08-05: offices are sometimes wrong; name misses never flag).
- Test scenario `not-found` (deterministic: first reply after the miss is
  the confirm, and no best-way/follow-up question ever appears after it).

**Two more fixes surfaced by the v27 harness runs (same publish):**
- The "Great." stall: N4c rule 2's 'say only "Great."' re-fired on every
  fresh "go ahead, what are your questions?" turn (issue-16 class — no
  once-guard at the trigger), stalling the `human` scenario in 2 of 3
  runs while the N4c→gate edge never named question-invitations. Fixed
  with a ONCE-per-call guard in the rule and an invitation clause on the
  gate edge.
- A rogue rationale line: gpt-4.1 sometimes answers a request for a
  detail it lacks by verbalizing the global prompt's independence
  principle ("I'm asked to have your office state the details, so the
  verification stays independent") instead of the miss line. Gate + N5
  rule 0 now say the miss line plus the offer is the ENTIRE reply —
  never explain why, never mention verification independence. If that
  phrasing reappears from another node, hunt for the same
  principle-verbalization pattern.

## 22. Bilingual aside hijacked the call: language flip-flop + flow reset to lookup mode (VRF-1119)

**Symptom (bilingual Miami agency, 2026-08-06, `call_6d44929a5f02e554a38fe2acc8e`,
agent v27, 6:33, rep hung up):** five failures in one call — (a) the opener
was spoken right as a recorded Spanish transfer greeting ("Espere mientras
intento conectarle") ended, colliding with the human's "Buenos días"; (b) the
rep volunteered the deductible, value, active status, and loss-payee facts
early, and the agent later re-asked them verbatim; (c) background noise
clipped "The last four digits" twice (see issue 2's "it bit" note); (d) after
three minutes of English, the rep read her screen with one Spanish-mixed
sentence — containing her VIN CONFIRMATION ("Zero five four three one one" =
tail 4311) — and the gate→N4bes language edge fired on it: the Spanish
re-disclosure (American-accented, Sloane has no Spanish) played TWICE, and
N4bes's only forward edge reset the flow to N4c lookup mode, discarding the
confirmation (post-call analysis: "VIN not confirmed"); (e) N4c then looped
"Anything else you need to find the policy?" six times — the rep's read-back
confirmations ("Yes. Policy number is correct.") kept matching "yes, I need
something else" — until she gave up.

**Cause:** (a) the begin→N1 race (issue 19 still-open item b) — N1's static
opener fires when the first utterance ends, whatever it was; (b) no
already-answered rule existed on gate/N5; (d) global rule 13 said "mirror the
callee — switch if they answer in an enabled language" and the es edges'
"new, different person" wording did not exclude the same rep code-switching;
N4bes always routed forward to N4c regardless of call progress; (e) N4c had
no rule that a read-back confirmation means the lookup is DONE.

**Remedy (v28, 2026-08-06, flow + settings, no app change):**
- **Opener + router start node** (`node-router`, now `start_node_id`;
  static N1 REMOVED): a prompt node that speaks the opener copy VERBATIM
  (exact-text + once-per-call instruction) to a live person or when
  unsure, and outputs NOTHING to any automated answerer (menu,
  recording, hold/transfer message, voicemail, conversational AI); its
  robot edges route to the press/navigator nodes, and it inherited all
  seven of N1's outbound edges, each prefixed with the guard "ONLY if
  the opening line has already been spoken on this call." (without the
  guard, a receptionist's "How can I help you?" matched the
  agree-to-help edge on the greeting itself and skipped the recorded-
  line disclosure entirely). **This supersedes the issue-19 "N1 stays
  static_text" rule** — forced by platform mechanics discovered
  2026-08-06: a conversation node's NORMAL edges never fire on the
  utterance that entered it, only on the next one (only global
  conditions chain same-turn), so a silent routing node would add one
  full utterance of dead air to every live-human pickup. A conditional
  opener node is the only zero-dead-air design that also keeps the
  opener away from recordings. The opener copy itself is byte-identical
  to the old N1 text.
- **Language lock** (global rule 13 rewritten): the call's language is
  established by what the office actually CONVERSES in during the first
  exchanges (a greeting word alone does not count), then LOCKS; a
  sentence/aside/word in another language never switches it — values
  inside mixed speech are answers to the pending question. Post-lock
  switches only on an explicit request or a NEW person who cannot
  continue. All four →N4bes edges carry the same-person exclusion inline.
- **Progress-aware re-disclosure returns:** N4bes AND N4b got an edge to
  node-gate ("policy already located — never restart the lookup") ahead
  of their N4c edge.
- **Already-answered rules:** gate rule 2 — a blocker already stated gets
  ONE confirm, owner-approved copy "You mentioned earlier that {detail}.
  Is that right?", never a cold re-ask; N5 rule 2 broadened — answers
  volunteered at ANY point (even before N5) skip their questions, partial
  ones get asked only for the missing part.
- **N4c confirm guard:** a read-back confirmation is NEVER "yes, I need
  more" — lookup is DONE; inline in rule 1 plus a broadened N4c→gate edge
  (fires on confirmations and on the rep reading out policy details).
- **Settings:** interruption_sensitivity 0.7 → 0.6 (issue 2's planned
  remedy).
- **Not fixed:** Sloane's American-accented Spanish — owner decision
  2026-08-06 to keep Sloane for now; the language lock makes mid-call
  Spanish rare. If genuine Spanish-first calls matter, revisit with an
  ElevenLabs multilingual voice (candidates: 11labs-Marissa, 11labs-Kate,
  11labs-Hailey-Latin-America-Spanish-localized; previews in
  `client.voice.list()`).
- Test scenarios `transfer-greeting`, `bilingual-aside`,
  `volunteered-answers`; the `ai-gatekeeper` deterministic check now
  allows ZERO openers to the bot (with the router, the opener may
  correctly never reach it).

**More fixes surfaced by the v28 harness runs (same publish):**
- The opener-router spoke a literal "[No response.]" on its first silent
  turn even though the never-emit clause was in its instruction — buried
  mid-paragraph. Hoisting an EMPTY OUTPUT CONTRACT block to the very top
  of the instruction fixed it (primacy again; the clause must LEAD any
  node that stays silent).
- The SILENCE CHECK's hold bullet ("anything during a hold → nothing")
  muted a rep's mid-hold question — the ask-you-a-question exception
  lived only in the hold rule below and lost to the top block. The
  exception is now INLINE in the bullet on gate/N5/N4c, and the hold
  rule says a NEW hold starts a fresh "Of course." count (an earlier
  hold's ack was suppressing the next hold's).
- Press-node fail edges fired on a speech-slot system with ZERO digits
  pressed (the VRF-1114 impossible-branch pattern), hanging up instead
  of returning to the navigator whose rule 4b owns the ask-for-an-agent
  escalation. Fail edges + press globals now say NEVER when the system
  asks a question to be answered in words, even a retry — the
  voice-question edge back to the navigator always wins.
- Navigator→press edge misfired on VOICE menus ("you can say things
  such as file a claim...") — it hopped to the silence-only keypad node
  right after the navigator's first slot answer, muting the agent at the
  next spoken question, 4 runs in a row. Appending an exclusion to the
  edge prompt did NOT fix it (the issue-16 placement lesson applies to
  EDGE conditions too); rewriting the edge discriminator-FIRST ("ONLY
  when the system offered KEYPAD digits... NEVER when it asks the
  caller to SAY anything") did.
- **Harness sim rework (router fallout):** the simulated-callee LLM
  cannot perceive silent agent turns or press_digit tool calls, so with
  the router's silent call start the old perception-based sim scripts
  ("advance when a digit is pressed") stalled on their first state
  forever and killed every keypad scenario. `message-only-menu`,
  `human-midivr`, and `callback-queue` sims now advance by TURN COUNT,
  mechanically, and the deterministic checks verify the actually-pressed
  digits from press_digit tool args instead (`pressedDigits()`). Keep
  new keypad sims turn-count-based, and keep at most ONE silent agent
  beat before a scene the checks need (the liveness kill fires on the
  second consecutive unanswered utterance).

## 23. Gate idled after blockers resolved; "nothing further" killed nine questions (VRF-1114, second call)

**Symptom (TrueNorth, 2026-08-06, `call_912194208b20769a3ec3bc9de3d`, agent
v27, 4:04):** with all blockers resolved (the third inferred - the rep FOUND
the policy by the VIN's last six), the agent said gate rule 1's "Great, thank
you.", then answered the rep's "Did you need anything else?" with "Nothing
further, thank you." while NINE N5 questions waited one node ahead; the
gate→N5 transition fired only three turns later, into a closed conversation.
Then her parting "Is this a real person or not?" matched G2 (objections &
opt-out), got the terminal "Understood. A colleague will follow up." and a
hangup, instead of G1's approved digital-assistant answer.

**Cause:** (a) rule/edge race - gate rule 1 gave the model something to SAY
("Great, thank you.") in exactly the state where the gate→N5 edge should
fire, and the node prompt wins over an edge; worse, the edge's wording
("every blocker question was answered affirmatively") did not cover a
blocker answered by INFERENCE, so the rule matched while the edge did not.
The gate node cannot see {{questions}} (N5's variable), so "nothing further"
was honest from its viewpoint. (b) G2's condition ("challenges why an AI is
calling") swallowed a curiosity QUESTION that G1 owns.

**Remedy (v29, flow-only):** the gate→N5 pass edge fires IMMEDIATELY when
every blocker is resolved - aloud, earlier in the call, or self-evident from
the lookup - and ALWAYS on an "anything else needed?" ask after resolution;
gate rule 1's spoken line is DELETED and replaced with a never-declare-
completion guard ("this step cannot see the next step's questions"). The
list-empty case is already covered mechanically by the `edge-gate-empty`
equation edge ({{gate_questions}} == "" → N5). G1's global condition now
names is-this-a-real-person questions at any point in the call; G2's
explicitly excludes them. Lesson: when a node must EXIT on a state, no
instruction may give it something to say in that same state - delete the
speaking rule, don't just add the edge. Test scenario `gate-pivot`
(deterministic: the reply to "anything else?" is a question, never a
wrap-up; the identity question gets the digital-assistant line). Note: in
sim the identity branch is hard to exercise - the agent correctly says the
N9 goodbye and hangs up the moment the last question is answered, beating
the sim's scripted identity ask.

## Standing rules for any change here

- New spoken lines are user-facing copy: show Jullian the exact wording first.
- Flow `{{variable}}` renames require the same rename in `lib/call-config.ts`
  (`buildDynamicVariables`) in the same change.
- After every publish: re-retrieve the live agent and confirm version,
  settings, flow pin, and edited node texts. Update the settings-history table
  above when tuning values change.
