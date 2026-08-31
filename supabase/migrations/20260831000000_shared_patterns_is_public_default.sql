-- Captures the current live default/nullability of shared_patterns.is_public
-- in tracked migration history. The column originated in an untracked file
-- (migrations/002_add_is_public_to_shared_patterns.sql, outside
-- supabase/migrations/) as `DEFAULT FALSE`, nullable — but the live database
-- has since had it changed to `DEFAULT true NOT NULL` by some untracked
-- change. This migration doesn't change anything live (idempotent — sets it
-- to what it already is); it exists so a fresh database built purely from
-- supabase/migrations/ ends up matching production instead of silently
-- diverging on this column's default.

update public.shared_patterns set is_public = true where is_public is null;

alter table public.shared_patterns
  alter column is_public set default true,
  alter column is_public set not null;
