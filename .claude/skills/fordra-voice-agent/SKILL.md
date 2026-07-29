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
- **Diagnosing a call:** `client.call.retrieve(callId)` gives `latency`
  (e2e/llm/tts/asr percentiles) and `transcript_object` with per-word
  timestamps — overlapping start/end times show exactly who talked over whom.
  Post-call extraction lands in `call_analysis.custom_analysis_data`.

## Settings history

| Date (agent ver) | responsiveness | interruption_sensitivity | Why |
|---|---|---|---|
| through v16 | 0.8 | 0.45 | initial defaults |
| 2026-07-29 (v17) | 1.0 | 0.7 | VRF 1095 talk-over fixes (see issue 1) |

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

## Standing rules for any change here

- New spoken lines are user-facing copy: show Jullian the exact wording first.
- Flow `{{variable}}` renames require the same rename in `lib/call-config.ts`
  (`buildDynamicVariables`) in the same change.
- After every publish: re-retrieve the live agent and confirm version,
  settings, flow pin, and edited node texts. Update the settings-history table
  above when tuning values change.
