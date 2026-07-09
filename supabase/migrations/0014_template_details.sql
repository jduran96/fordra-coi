-- Standard-level free text: "Other Required Coverage Details" on saved
-- insurance standards (mirrors the manual-entry box on /app/new). Optional;
-- appended to the resolved requirements text as "Additional details: ...".
-- Idempotent. Table-level grants from 0011 already cover the new column.

alter table requirement_templates add column if not exists details text;

notify pgrst, 'reload schema';
