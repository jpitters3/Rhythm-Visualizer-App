import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

export function serviceClient() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
}

// The request's user when their profile has role 'admin', otherwise null.
export async function adminUser(req: Request) {
  const jwt = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!jwt) return null
  const supabase = serviceClient()
  const { data: { user } } = await supabase.auth.getUser(jwt)
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('role').eq('user_id', user.id).maybeSingle()
  return profile?.role === 'admin' ? user : null
}

export async function isAdmin(req: Request) {
  return !!await adminUser(req)
}
