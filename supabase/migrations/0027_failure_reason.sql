-- Failed verifications carry an admin-written reason the customer sees on the
-- results page. Exposed through my_verifications UNGATED (like error_detail):
-- a failed case is never published, so publish-gating would hide the one
-- thing the customer needs to read.

alter table verifications add column if not exists failure_reason text;

-- 'failed' fully replaces 'rejected' (owner decision 2026-07-16): migrate old
-- rows so nothing renders as Rejected anywhere. Legacy rows have no reason;
-- the customer notice omits the reason line when it is null.
update verifications set case_status = 'failed' where case_status = 'rejected';

-- DROP + CREATE, not OR REPLACE, for the same reason as 0008: the runner
-- re-applies every file on every run, and OR REPLACE cannot widen a view once
-- a later definition exists. Supabase default privileges re-grant the view to
-- authenticated/service_role on create; anon is revoked explicitly.
drop view if exists my_verifications;
create view my_verifications as
 select id,
    display_id,
    org_id,
    created_by,
    source,
    status,
    case_status,
    carrier_name,
    verifier_company,
    eta,
    error_detail,
    failure_reason,
    cost_usd,
    requirements,
    manual_notes,
    published_at,
    created_at,
    updated_at,
        case when published_at is not null then agent_questions       else null::jsonb end as agent_questions,
        case when published_at is not null then insurance_contact     else null::jsonb end as insurance_contact,
        case when published_at is not null then coi_extracted         else null::jsonb end as coi_extracted,
        case when published_at is not null then gap_analysis          else null::jsonb end as gap_analysis,
        case when published_at is not null then call_transcript       else null::text  end as call_transcript,
        case when published_at is not null then call_extracted_answers else null::jsonb end as call_extracted_answers,
        case when published_at is not null then final_report          else null::jsonb end as final_report,
        case when published_at is not null then call_notes            else null::jsonb end as call_notes
   from verifications
  where org_id = current_org();

revoke all on my_verifications from anon;
