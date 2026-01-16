-- Add sort_order column
ALTER TABLE public.user_handpans 
ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0;

-- Add unique constraint on (user_id, name)
-- First, handling duplicates if any (optional, but good practice)
-- (Skipping complex dedupe for now, assuming user will fix if constraint fails)

ALTER TABLE public.user_handpans
ADD CONSTRAINT unique_user_handpan_name UNIQUE (user_id, name);
