
-- Add label_preference column to profiles table
ALTER TABLE profiles 
ADD COLUMN label_preference TEXT DEFAULT 'Numbers';
