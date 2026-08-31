-- Add bottom_image_url column to user_handpans table

ALTER TABLE user_handpans 
ADD COLUMN bottom_image_url TEXT;

-- Update RLS policies if necessary (usually existing policies cover updates to own rows)
-- Ensure 'public' bucket allows authenticated uploads for handpan-images if not already set.
