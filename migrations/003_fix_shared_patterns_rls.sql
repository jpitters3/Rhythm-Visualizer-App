-- Enable RLS on shared_patterns
ALTER TABLE shared_patterns ENABLE ROW LEVEL SECURITY;

-- Drop all existing policies to ensure a clean slate
DROP POLICY IF EXISTS "Public patterns are viewable by everyone" ON shared_patterns;
DROP POLICY IF EXISTS "Users can insert their own patterns" ON shared_patterns;
DROP POLICY IF EXISTS "Users can update their own patterns" ON shared_patterns;
DROP POLICY IF EXISTS "Users can delete their own patterns" ON shared_patterns;
DROP POLICY IF EXISTS "Enable read access for all users" ON shared_patterns;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON shared_patterns;
DROP POLICY IF EXISTS "Enable update for users based on user_id" ON shared_patterns;
DROP POLICY IF EXISTS "Enable delete for users based on user_id" ON shared_patterns;

-- Create comprehensive policies

-- 1. SELECT: Allow everyone to read ALL patterns. 
--    Security for private patterns relies on the difficulty of guessing the 'share_id'.
--    This is necessary so that 'Private Link Checking' works for non-authenticated users.
CREATE POLICY "Enable read access for all users" ON shared_patterns
    FOR SELECT
    USING (true);

-- 2. INSERT: Authenticated users can create patterns where they are the owner
CREATE POLICY "Enable insert for users based on user_id" ON shared_patterns
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- 3. UPDATE: Users can update their own patterns
CREATE POLICY "Enable update for users based on user_id" ON shared_patterns
    FOR UPDATE
    USING (auth.uid() = user_id);

-- 4. DELETE: Users can delete their own patterns
CREATE POLICY "Enable delete for users based on user_id" ON shared_patterns
    FOR DELETE
    USING (auth.uid() = user_id);
