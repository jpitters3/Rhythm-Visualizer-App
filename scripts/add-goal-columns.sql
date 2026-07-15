-- Add goal columns to profiles table
-- Run this in the Supabase SQL editor

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS dream_goal text,
  ADD COLUMN IF NOT EXISTS short_term_goal text;
