-- Function to check if an email exists in auth.users
-- SECURITY DEFINER allows it to read auth.users even from the public schema
-- Called via RPC from the check-email-exists edge function

CREATE OR REPLACE FUNCTION public.check_email_exists(p_email text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users WHERE email = lower(trim(p_email))
  );
$$;

-- Restrict execution to authenticated and service_role only (not anon)
REVOKE ALL ON FUNCTION public.check_email_exists(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_email_exists(text) TO service_role;
