-- Add first_name and last_name columns to profiles table
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS first_name TEXT,
ADD COLUMN IF NOT EXISTS last_name TEXT;
