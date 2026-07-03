-- Migration: Add library_folders table and folder_id columns
-- Run this in Supabase SQL editor

-- 1. Folders table
CREATE TABLE IF NOT EXISTS library_folders (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  tab        TEXT NOT NULL CHECK (tab IN ('phrases', 'compositions')),
  parent_id  UUID REFERENCES library_folders(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE library_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own folders" ON library_folders
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 2. Add folder_id to patterns
ALTER TABLE patterns
  ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES library_folders(id) ON DELETE SET NULL;

-- 3. Add folder_id to compositions
ALTER TABLE compositions
  ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES library_folders(id) ON DELETE SET NULL;

-- 4. Archive support
ALTER TABLE patterns
  ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT false;

ALTER TABLE compositions
  ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT false;
