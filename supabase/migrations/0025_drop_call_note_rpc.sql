-- Cleanup: drop the pre-contact-log append RPC (0016). Superseded by
-- admin_append_contact_note (0022); kept through the 2026-07-16 deploy window
-- because prod (same database) still called it until the new code shipped.
-- Prod is verified on the new code, so nothing calls this anymore.
drop function if exists admin_append_call_note(uuid, text, jsonb);
