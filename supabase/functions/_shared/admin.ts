import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

export function serviceClient() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
}

// True when the request's JWT belongs to a profile with role 'admin'.
export async function isAdmin(req: Request) {
  const jwt = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!jwt) return false
  const supabase = serviceClient()
  const { data: { user } } = await supabase.auth.getUser(jwt)
  if (!user) return false
  const { data: profile } = await supabase.from('profiles').select('role').eq('user_id', user.id).maybeSingle()
  return profile?.role === 'admin'
}
