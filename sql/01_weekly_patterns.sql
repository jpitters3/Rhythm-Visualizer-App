-- Create weekly_patterns table
CREATE TABLE IF NOT EXISTS public.weekly_patterns (
    id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
    pattern_id uuid REFERENCES public.patterns(id) ON DELETE CASCADE NOT NULL,
    launch_date timestamp with time zone NOT NULL,
    difficulty integer, -- 1-10 scale
    description text,
    created_at timestamp with time zone DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.weekly_patterns ENABLE ROW LEVEL SECURITY;

-- Policy: Everyone can read active patterns
CREATE POLICY "Public read active" ON public.weekly_patterns
    FOR SELECT
    USING (launch_date <= now());

-- Policy: Admins can do everything
-- Note: Requires an 'admins' table or specific email check. 
-- For now, we'll assume a simple email check if you have an auth.email() function, 
-- or you can manually add your user UUID here.
-- ADJUST THIS POLICY TO MATCH YOUR ADMIN STRATEGY
CREATE POLICY "Admin full access" ON public.weekly_patterns
    FOR ALL
    USING (
        auth.jwt() ->> 'email' IN ('jpitters3@gmail.com') 
    );
