/**
 * send-practice-reminders
 *
 * Called every 15 minutes by a pg_cron job (see
 * 20260728_practice_reminders_scheduler.sql). Finds every enabled
 * practice_reminders row that is due *right now* in its own timezone —
 * accounting for daily/weekly frequency, days_of_week, and lead_minutes —
 * and sends via email (send-notification-email) and/or Web Push, per each
 * reminder's own notify_email/notify_push flags.
 *
 * Exact-minute matching (not a "due within the last 15 min" window) still
 * works at this cadence because time_of_day is constrained to the :00/:15/
 * :30/:45 grid and every lead_minutes option (0/15/30/60) is a multiple of
 * 15 — so a due reminder's target minute always lands exactly on a tick.
 *
 * Required env vars (set in Supabase dashboard → Edge Functions → Secrets):
 *   CRON_SECRET        — shared secret; must match the `app.cron_secret`
 *                         Postgres setting the cron job sends as the
 *                         x-cron-secret header.
 *   VAPID_PUBLIC_KEY    — must match js/push-notifications.js's constant.
 *   VAPID_PRIVATE_KEY   — keep server-side only.
 *
 * Auto-injected by Supabase (no manual setup needed):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * This function must have "Verify JWT" disabled (Dashboard → Edge Functions
 * → this function → Settings) since pg_cron calls it with no user session.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'https://esm.sh/web-push@3.6.7'

const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')
const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')
if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails('mailto:justin@panafide.com', vapidPublicKey, vapidPrivateKey)
}

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

type Reminder = {
  id: string
  user_id: string
  frequency: 'daily' | 'weekly'
  days_of_week: number[]
  time_of_day: string // "HH:MM:SS"
  timezone: string
  lead_minutes: number
  notify_email: boolean
  notify_push: boolean
  last_sent_date: string | null
}

function isDueNow(r: Reminder, now: Date): { due: boolean; localDateStr: string } {
  const tz = r.timezone || 'UTC'
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(now).map(p => [p.type, p.value])
  ) as Record<string, string>

  const nowWeekday = WEEKDAY_INDEX[parts.weekday]
  const nowMinutes = Number(parts.hour) * 60 + Number(parts.minute)
  const localDateStr = `${parts.year}-${parts.month}-${parts.day}`

  const [th, tm] = r.time_of_day.split(':').map(Number)
  let targetMinutes = th * 60 + tm - r.lead_minutes
  let dayShift = 0
  if (targetMinutes < 0) { targetMinutes += 1440; dayShift = -1 }
  else if (targetMinutes >= 1440) { targetMinutes -= 1440; dayShift = 1 }

  // If firing today requires shifting across midnight, "today" corresponds
  // to a different practice weekday than today's own — e.g. a Monday
  // reminder with a lead time that crosses midnight actually fires Sunday
  // night, so Sunday must check membership against Monday, not Sunday.
  const practiceWeekdayForToday = (nowWeekday - dayShift + 7) % 7
  const dayMatches = r.frequency === 'daily' || (r.days_of_week || []).includes(practiceWeekdayForToday)

  const due = dayMatches && nowMinutes === targetMinutes && r.last_sent_date !== localDateStr
  return { due, localDateStr }
}

// Sends to every device the user has push-subscribed. A subscription that
// the push service reports as gone (404/410 — user revoked permission,
// uninstalled, etc.) is deleted so it stops being retried forever.
async function sendPushToUser(
  supabaseAdmin: ReturnType<typeof createClient>,
  userId: string,
  payload: { title: string; body: string; url: string }
) {
  const { data: subs } = await supabaseAdmin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId)

  for (const sub of subs ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload)
      )
    } catch (err: any) {
      const statusCode = err?.statusCode
      if (statusCode === 404 || statusCode === 410) {
        await supabaseAdmin.from('push_subscriptions').delete().eq('id', sub.id)
      } else {
        console.error('[send-practice-reminders] push send error:', err?.message ?? err)
      }
    }
  }
}

Deno.serve(async (req) => {
  const cronSecret = Deno.env.get('CRON_SECRET')
  if (cronSecret && req.headers.get('x-cron-secret') !== cronSecret) {
    return new Response('Forbidden', { status: 403 })
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { data: reminders, error } = await supabaseAdmin
    .from('practice_reminders')
    .select('id, user_id, frequency, days_of_week, time_of_day, timezone, lead_minutes, notify_email, notify_push, last_sent_date')
    .eq('enabled', true)

  if (error) {
    console.error('[send-practice-reminders] fetch error:', error.message)
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }

  const now = new Date()
  let sent = 0

  for (const r of (reminders ?? []) as Reminder[]) {
    const { due, localDateStr } = isDueNow(r, now)
    if (!due) continue

    if (r.notify_email) {
      const { error: emailError } = await supabaseAdmin.functions.invoke('send-notification-email', {
        body: {
          userIds: [r.user_id],
          type: 'practice_reminder',
          title: 'Time to practice! 🥁',
          body: "It's time for your scheduled handpan practice — even five minutes keeps the streak alive.",
          cta_url: 'https://panafide.com/#practice',
          cta_text: 'Start practicing',
        },
      })
      if (emailError) console.error('[send-practice-reminders] email send error:', emailError.message)
    }

    if (r.notify_push && vapidPublicKey && vapidPrivateKey) {
      await sendPushToUser(supabaseAdmin, r.user_id, {
        title: 'Time to practice! 🥁',
        body: "It's time for your scheduled handpan practice — even five minutes keeps the streak alive.",
        url: 'https://panafide.com/#practice',
      })
    }

    await supabaseAdmin
      .from('practice_reminders')
      .update({ last_sent_date: localDateStr })
      .eq('id', r.id)

    sent++
  }

  return new Response(JSON.stringify({ checked: reminders?.length ?? 0, sent }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
