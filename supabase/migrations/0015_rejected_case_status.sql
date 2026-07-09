-- Admin can reject a verification request outright (invalid/withdrawn
-- submission). Rejected verifications leave the review queue and appear
-- under Completed in /admin without ever being published to the customer.
alter type case_status add value if not exists 'rejected';
