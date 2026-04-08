/**
 * send-notification-email
 *
 * Sends a notification email to one or more recipients.
 * Respects each recipient's notification_preferences (email toggle).
 *
 * Expected body (two modes):
 *   { to: string,        type, title, body }  — single address
 *   { userIds: string[], type, title, body }  — look up emails via service role
 *
 * Required env vars (set in Supabase dashboard → Edge Functions → Secrets):
 *   RESEND_API_KEY   — Resend API key
 *   EMAIL_FROM       — verified sender address, e.g. "Groove Pan <noreply@yoursite.com>"
 *
 * Auto-injected by Supabase (no manual setup needed):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { to, userIds, type, title, body, cta_url, cta_text } = await req.json()
    const adminEmail = 'justin@panafide.com'
    const resendKey = Deno.env.get('RESEND_API_KEY')
    const from     = Deno.env.get('EMAIL_FROM') ?? adminEmail

    if (!resendKey) {
      console.error('[send-notification-email] RESEND_API_KEY not set')
      return jsonResponse({ error: 'Email service not configured' }, 500)
    }

    if (!title) {
      return jsonResponse({ error: 'Missing required fields' }, 400)
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Resolve { id, email } pairs so we can filter by preferences
    let resolvedUsers: { id: string; email: string }[] = []

    if (Array.isArray(userIds) && userIds.length > 0) {
      const lookups = await Promise.all(
        userIds.map(id => supabaseAdmin.auth.admin.getUserById(id))
      )
      resolvedUsers = lookups
        .filter(r => !r.error && r.data?.user?.email)
        .map(r => ({ id: r.data.user!.id, email: r.data.user!.email! }))
    } else if (to) {
      // Single address mode — no preference filtering (no user ID available)
      resolvedUsers = [{ id: '', email: to }]
    }

    if (resolvedUsers.length === 0) {
      return jsonResponse({ error: 'No valid recipients' }, 400)
    }

    // Filter out users who have opted out of email for this notification type.
    // A missing preference row means email is enabled (opt-out model).
    if (type && resolvedUsers.some(u => u.id)) {
      const idsToCheck = resolvedUsers.filter(u => u.id).map(u => u.id)
      const { data: optedOut } = await supabaseAdmin
        .from('notification_preferences')
        .select('user_id')
        .in('user_id', idsToCheck)
        .eq('notif_type', type)
        .eq('email', false)

      const optedOutIds = new Set((optedOut ?? []).map((p: { user_id: string }) => p.user_id))
      resolvedUsers = resolvedUsers.filter(u => !optedOutIds.has(u.id))
    }

    if (resolvedUsers.length === 0) {
      return jsonResponse({ skipped: true, reason: 'All recipients opted out' })
    }

    const recipients = resolvedUsers.map(u => u.email)
    const html = buildHtml(title, body, cta_url, cta_text)

    // Resend requires a visible To address; use a no-reply placeholder
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: adminEmail, bcc: recipients, subject: title, html }),
    })

    if (!res.ok) {
      const err = await res.text()
      console.error('[send-notification-email] Resend error:', err)
      return jsonResponse({ error: err }, 500)
    }

    const data = await res.json()
    return jsonResponse({ id: data.id })

  } catch (err: any) {
    console.error('[send-notification-email] Exception:', err.message)
    return jsonResponse({ error: err.message }, 500)
  }
});

function buildHtml(title: string, body: string | null, ctaUrl?: string, ctaText?: string): string {
  const safeBody = body
    ? body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    : ''

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body { font-family: sans-serif; background: #f5f5f5; margin: 0; padding: 32px 16px; }
    .card { background: #fff; border-radius: 8px; max-width: 520px; margin: 0 auto; padding: 32px; }
    .logo { display: block; margin: 0 auto 24px; width: 140px; }
    .divider { border: none; border-top: 1px solid #eee; margin: 0 0 24px; }
    h2 { margin: 0 0 16px; font-size: 1.2rem; color: #111; }
    p  { margin: 0; color: #444; line-height: 1.6; }
    .cta { margin-top: 24px; }
    .cta a { background-color: #6366f1; color: #fff; font-weight: bold; text-decoration: none; padding: 10px 20px; border-radius: 6px; display: inline-block; }
    .footer { margin-top: 32px; font-size: 0.8rem; color: #999; }
  </style>
</head>
<body>
  <div class="card">
    <img class="logo" src="https://panafide.com/assets/images/logo.png" alt="Panafide" />
    <hr class="divider" />
    <h2>${title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</h2>
    ${safeBody ? `<p>${safeBody}</p>` : ''}
    <p class="cta"><a href="${ctaUrl ?? 'https://panafide.com/'}">${(ctaText ?? 'Open Panafide').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</a></p>
    <p class="footer">You received this email from Panafide.</p>
  </div>
</body>
</html>`
}
