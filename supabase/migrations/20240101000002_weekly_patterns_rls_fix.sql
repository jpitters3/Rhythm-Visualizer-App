-- Drop potentially conflicting or incorrect policies
DROP POLICY IF EXISTS "Admin full access" ON public.weekly_patterns;
DROP POLICY IF EXISTS "Public read active" ON public.weekly_patterns;

-- 1. Public Read: Only past/current patterns
CREATE POLICY "Public read active" ON public.weekly_patterns
    FOR SELECT
    USING (launch_date <= now());

-- 2. Admin Full Access: Everything (including future dates)
-- Ensure your email matches this exactly (case insensitive check)
CREATE POLICY "Admin full access" ON public.weekly_patterns
    FOR ALL
    USING (
        lower(auth.jwt() ->> 'email') IN ('jpitters3@gmail.com')
    );
