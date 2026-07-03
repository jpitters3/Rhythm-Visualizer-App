-- =============================================
-- METHOD RHYTHMS
-- Admin-curated rhythm cards for The Panafide Method view.
-- Each card has a name, description, and optional pattern_json
-- (a serialized phrase the admin sets from the studio).
-- =============================================

create table if not exists method_rhythms (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  subtitle      text,                        -- e.g. "3-3-2 Subdivision"
  description   text,
  badge_emoji   text,
  badge_text    text,
  pattern_json  jsonb,                       -- serialized phrase for audio preview
  order_index   integer not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

alter table method_rhythms enable row level security;

-- Anyone can read active rhythms (public-facing feature)
create policy "method_rhythms_read" on method_rhythms
  for select using (active = true);

-- Only admins can insert/update/delete (enforced in app layer via isAdminUser;
-- RLS here restricts to service role only so the client SDK cannot mutate)
-- Admin writes go through supabase admin client / edge functions.

-- =============================================
-- SEED: initial rhythm cards
-- =============================================

insert into method_rhythms (name, subtitle, description, badge_emoji, badge_text, order_index) values
  (
    'The Tresillo Rhythm',
    '3-3-2 Subdivision',
    'One of the most universal rhythms in music. You''ll find it in Afro-Cuban, reggaeton, jazz, pop — everywhere. Once you hear it, you''ll start recognizing it everywhere.',
    '🌍',
    'Found in all genres',
    1
  ),
  (
    'Warmth of the Sun''s Rays',
    'Hang Massive',
    'A simple, spacious rhythm made popular by Hang Massive. It has a meditative, floating quality — easy to learn, beautiful to play, and deeply satisfying.',
    '☀️',
    'Meditative & spacious',
    2
  ),
  (
    'Espelhos No Mar',
    'Open & Airy',
    'A spacious rhythm that breathes. You can leave it open and airy, or fill every gap with melody and fills. It rewards both restraint and expressiveness.',
    '🌊',
    'Meditative to expressive',
    3
  ),
  (
    'The Malte Rhythm',
    'Malte Marten',
    'Made popular by Malte Marten. It has a distinctive groove that''s immediately recognizable once you''ve heard it. Hypnotic, grounded, and uniquely handpan.',
    '🎵',
    'Instantly recognizable',
    4
  )
on conflict do nothing;
