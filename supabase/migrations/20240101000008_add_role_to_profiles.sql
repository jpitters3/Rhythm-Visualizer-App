-- SQL script to add the 'role' column to the 'profiles' table.
-- Roles include: admin, student, teacher.
-- The default role is set to 'student'.

-- Using a TEXT column with a CHECK constraint for simplicity and flexibility,
-- avoiding the need to manage ENUM types if roles change in the future.

-- 1. Add the column (if it doesn't already exist) with the default value.
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS role text DEFAULT 'student'::text;

-- 2. Drop the constraint if it already exists (useful if you need to run this script again to update the valid roles)
ALTER TABLE public.profiles
DROP CONSTRAINT IF EXISTS valid_user_roles;

-- 3. Add the check constraint to ensure only valid roles are allowed
ALTER TABLE public.profiles
ADD CONSTRAINT valid_user_roles CHECK (role IN ('admin', 'student', 'teacher'));
