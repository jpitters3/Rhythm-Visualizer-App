-- Add pattern_name column to lessons table
ALTER TABLE lessons
ADD COLUMN pattern_name TEXT NULL;

-- Comment: This column stores the name of the pattern at the time of snapshotting.
-- It is primarily for UI convenience (restoring dropdown state) and does not inherently link to a live pattern ID.
