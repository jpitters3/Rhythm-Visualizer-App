-- Add image_rotation column to user_handpans table
ALTER TABLE public.user_handpans 
ADD COLUMN IF NOT EXISTS image_rotation numeric DEFAULT 0;
