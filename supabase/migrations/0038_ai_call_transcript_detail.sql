-- Structured Retell transcript (transcript_with_tool_calls): utterances with
-- word timings plus tool calls, DTMF presses, and node transitions. The flat
-- `transcript` column stays authoritative for extraction and published notes.
-- Table-level revokes + RLS from 0032 cover new columns; no grant changes.
alter table ai_calls add column if not exists transcript_detail jsonb;
