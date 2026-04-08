-- Create the Glossary Terms table
CREATE TABLE IF NOT EXISTS public.glossary_terms (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    term TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    definition TEXT NOT NULL,
    video_url TEXT,
    related_course_ids UUID[] DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Essential RLS Policies

-- Enable Row Level Security
ALTER TABLE public.glossary_terms ENABLE ROW LEVEL SECURITY;

-- Policy 1: Anyone can read glossary terms (public access for students)
CREATE POLICY "Public profiles are viewable by everyone."
ON public.glossary_terms FOR SELECT
USING (true);

-- Policy 2: Only administrators can insert terms
CREATE POLICY "Admins can insert glossary terms"
ON public.glossary_terms FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE profiles.id = auth.uid() 
    AND profiles.role = 'admin'
  )
);

-- Policy 3: Only administrators can update terms
CREATE POLICY "Admins can update glossary terms"
ON public.glossary_terms FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE profiles.id = auth.uid() 
    AND profiles.role = 'admin'
  )
);

-- Policy 4: Only administrators can delete terms
CREATE POLICY "Admins can delete glossary terms"
ON public.glossary_terms FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE profiles.id = auth.uid() 
    AND profiles.role = 'admin'
  )
);

-- Create updated_at trigger for glossary_terms
CREATE OR REPLACE FUNCTION update_modified_column() 
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW; 
END;
$$ language 'plpgsql';

CREATE TRIGGER update_glossary_terms_modtime
BEFORE UPDATE ON public.glossary_terms
FOR EACH ROW EXECUTE PROCEDURE update_modified_column();
