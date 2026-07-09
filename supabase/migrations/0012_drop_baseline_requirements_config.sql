-- Global baseline requirements are gone: requirements are entirely org-owned
-- (templates / submitted standards). Remove the stored admin override so it
-- can't silently mask anything (see repeat-bug #7); the config key no longer
-- exists in code (lib/config.ts).
delete from app_config where key = 'baseline_requirements';
