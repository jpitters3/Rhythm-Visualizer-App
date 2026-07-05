-- =============================================================================
-- Technique Flash Cards
-- Migration: 20260704_technique_flash_cards.sql
-- =============================================================================

create table if not exists public.technique_flash_cards (
  id                 uuid        default gen_random_uuid() primary key,
  category           text        not null,
  name               text        not null,
  is_default_enabled boolean     not null default true,
  sort_order         int         not null default 0,
  created_at         timestamptz default now()
);

alter table public.technique_flash_cards enable row level security;

create policy "Authenticated users can view technique flash cards"
  on public.technique_flash_cards for select
  using (auth.uid() is not null);

create policy "Teachers can manage technique flash cards"
  on public.technique_flash_cards for all
  using (public.current_user_role() in ('teacher', 'admin'));

-- ---------------------------------------------------------------------------
-- Seed
-- ---------------------------------------------------------------------------
insert into public.technique_flash_cards (category, name, is_default_enabled, sort_order) values
  -- Special Touch
  ('Special Touch', 'Harmonics',            true,  10),
  ('Special Touch', 'Knuckles',             true,  20),
  ('Special Touch', 'Fingertips',           true,  30),

  -- Dynamics
  ('Dynamics', 'Louder',                    true,  10),
  ('Dynamics', 'Quieter',                   true,  20),
  ('Dynamics', 'Faster',                    false, 30),
  ('Dynamics', 'Slower',                    false, 40),

  -- Ding Articulation
  ('Ding Articulation', 'Tak / Slap',       true,  10),
  ('Ding Articulation', 'Ding Bend',        true,  20),
  ('Ding Articulation', 'Fist Pound',       true,  30),

  -- Rolls
  ('Rolls', 'Single-Stroke Rolls',          true,  10),
  ('Rolls', 'Split Finger Rolls',           true,  20),
  ('Rolls', 'Paradiddle',                   false, 30),
  ('Rolls', 'Paradiddle Diddle',            false, 40),
  ('Rolls', 'Fingernail Rolls',             false, 50),

  -- Subdivisions
  ('Subdivisions', '8th Notes',             true,  10),
  ('Subdivisions', 'Triplets',              true,  20),
  ('Subdivisions', '16th Notes',            false, 30),
  ('Subdivisions', '32nd Notes',            false, 40),

  -- Patterns
  ('Patterns', 'Arpeggios',                 true,  10),

  -- Flashy Techniques
  ('Flashy Techniques', 'Flam',             true,  10),

  -- Time Signature (all disabled by default)
  ('Time Signature', '3/4',                 false, 10),
  ('Time Signature', '4/4',                 false, 20),
  ('Time Signature', '5/8',                 false, 30),
  ('Time Signature', '6/8',                 false, 40),
  ('Time Signature', '7/8',                 false, 50),
  ('Time Signature', '9/8',                 false, 60);
