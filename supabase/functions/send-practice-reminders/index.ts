/**
 * send-practice-reminders
 *
 * Called every 15 minutes by a pg_cron job (see
 * 20260728_practice_reminders_scheduler.sql). Finds every enabled
 * practice_reminders row that is due *right now* in its own timezone —
 * accounting for daily/weekly frequency, days_of_week, and lead_minutes —
 * and sends an email via the existing send-notification-email function.
 * Push isn't implemented yet; notify_push rows are simply skipped.
 *
 * Exact-minute matching (not a "due within the last 15 min" window) still
 * works at this cadence because time_of_day is constrained to the :00/:15/
 * :30/:45 grid and every lead_minutes option (0/15/30/60) is a multiple of
 * 15 — so a due reminder's target minute always lands exactly on a tick.
 *
 * Required env vars (set in Supabase dashboard → Edge Functions → Secrets):
 *   CRON_SECRET — shared secret; must match the `app.cron_secret` Postgres
 *                 setting the cron job sends as the x-cron-secret header.
 *
 * Auto-injected by Supabase (no manual setup needed):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * This function must have "Verify JWT" disabled (Dashboard → Edge Functions
 * → this function → Settings) since pg_cron calls it with no user session.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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
    // notify_push: not implemented yet — intentionally skipped.

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
