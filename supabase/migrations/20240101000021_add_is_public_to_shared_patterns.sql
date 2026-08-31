-- Add is_public column to shared_patterns table
ALTER TABLE shared_patterns 
ADD COLUMN is_public BOOLEAN DEFAULT FALSE;
