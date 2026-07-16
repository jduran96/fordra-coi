-- Expose call notes to customers through my_verifications, gated on publish like
-- every other analysis field.
--
-- DROP + CREATE, not CREATE OR REPLACE (2026-07-16): the migration runner
-- re-applies every file on every run, and OR REPLACE fails with "cannot drop
-- columns from view" as soon as any later migration has widened the view.
-- Dropping first keeps this file re-runnable forever. Supabase default
-- privileges re-grant the view to authenticated/service_role on create; anon
-- is revoked explicitly below to preserve the pre-existing grant set.

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
