-- Create the scale_calibrations table
CREATE TABLE IF NOT EXISTS public.scale_calibrations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    scale_id TEXT NOT NULL, -- Format: 'sys_<slug>' or 'custom_<uuid>'
    frequency_map JSONB DEFAULT '{}'::jsonb NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, scale_id)
);

-- Enable RLS
ALTER TABLE public.scale_calibrations ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view their own calibrations"
    ON public.scale_calibrations FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own calibrations"
    ON public.scale_calibrations FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own calibrations"
    ON public.scale_calibrations FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own calibrations"
    ON public.scale_calibrations FOR DELETE
    USING (auth.uid() = user_id);

-- Updated_at trigger (Optional but recommended)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_scale_calibrations_updated_at
    BEFORE UPDATE ON public.scale_calibrations
    FOR EACH ROW
    EXECUTE PROCEDURE update_updated_at_column();
