-- Add source column to patterns to distinguish origin type
-- Values: 'manual' (default), 'composition', 'midi_import', etc.

alter table public.patterns
  add column if not exists source text not null default 'manual';

comment on column public.patterns.source is
  'Origin of the pattern: manual (user-created), composition (exported from Song Composer), midi_import, etc.';
