-- Song Composer: compositions and composition_sections tables
-- Migration: 20260405_song_composer.sql

-- ============================================================
-- COMPOSITIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.compositions (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title       TEXT        NOT NULL DEFAULT 'Untitled Composition',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_compositions_user_id
  ON public.compositions(user_id);

ALTER TABLE public.compositions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "compositions_user_all"
  ON public.compositions FOR ALL
  TO authenticated
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- COMPOSITION SECTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.composition_sections (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  composition_id  UUID        REFERENCES public.compositions(id) ON DELETE CASCADE NOT NULL,
  position        INTEGER     NOT NULL DEFAULT 0,
  type            TEXT        NOT NULL CHECK (type IN ('phrase', 'recording', 'note')),
  title           TEXT,
  phrase_name     TEXT,   -- soft FK to patterns.name
  audio_url       TEXT,   -- signed URL or storage path for recordings
  note_text       TEXT,   -- free-form note content
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_composition_sections_comp_pos
  ON public.composition_sections(composition_id, position);

ALTER TABLE public.composition_sections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "composition_sections_user_all"
  ON public.composition_sections FOR ALL
  TO authenticated
  USING (
    composition_id IN (
      SELECT id FROM public.compositions WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    composition_id IN (
      SELECT id FROM public.compositions WHERE user_id = auth.uid()
    )
  );

-- ============================================================
-- STORAGE BUCKET: composition-audio
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit)
  VALUES ('composition-audio', 'composition-audio', false, 52428800)  -- 50 MB
  ON CONFLICT (id) DO NOTHING;

CREATE POLICY "composition_audio_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'composition-audio'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "composition_audio_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'composition-audio'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "composition_audio_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'composition-audio'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
