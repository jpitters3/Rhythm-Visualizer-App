-- Migration: Add separate image rotation for handpan bottom image
-- Run this in Supabase SQL editor

ALTER TABLE user_handpans
  ADD COLUMN IF NOT EXISTS bottom_image_rotation INTEGER DEFAULT 0;
