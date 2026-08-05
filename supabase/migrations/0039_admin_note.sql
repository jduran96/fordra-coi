-- Sticky note: one free-text scratchpad per verification, admin to admin.
--
-- Why (owner, 2026-08-04): when a case sits open past its business-day
-- target, the reason lives in the admin's head or buried in the contact log
-- (open the case -> AI tab -> scroll to the contact log -> read same-styled
-- prose until the latest outreach attempt turns up). The next admin picking
-- the queue up needs "left a voicemail, agent is out until Thursday" in one
-- glance. This is that line.
--
-- Deliberately NOT the customer-facing manual_notes: this is internal
-- shorthand and is never published, never reaches the report, and never
-- affects status. Same shape as assigned_admin (0036): admin-only bookkeeping
-- columns with NO grant to `authenticated` and no place in my_verifications,
-- so RLS + the column-level grants keep them invisible to customers even if
-- some future query forgets to exclude them. The view is untouched here for
-- exactly that reason.

alter table verifications add column if not exists admin_note text;
-- When the note was last saved, and which admin saved it — the queue and the
-- detail card show "EM, 2 hours ago" so a stale note is recognizable as stale.
alter table verifications add column if not exists admin_note_at timestamptz;
alter table verifications add column if not exists admin_note_by text;

comment on column verifications.admin_note is
  'Admin-only sticky note (free text). Never shown to customers: no grant to authenticated, not in my_verifications.';
