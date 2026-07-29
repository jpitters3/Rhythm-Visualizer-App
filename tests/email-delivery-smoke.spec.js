/**
 * tests/email-delivery-smoke.spec.js
 *
 * Unlike notification-email.spec.js (which mocks the Edge Function entirely
 * to verify the *app* sends the right request), this hits the real deployed
 * send-notification-email function and the real Resend API — no browser,
 * no mocking.
 *
 * Uses Resend's own sandboxed test addresses (delivered@resend.dev,
 * bounced@resend.dev) — no real email is ever sent, safe to run anytime.
 * https://resend.com/docs/dashboard/emails/send-test-emails
 */

const { test, expect } = require('@playwright/test');
require('dotenv').config();

const FN_URL = `${process.env.VITE_SUPABASE_URL}/functions/v1/send-notification-email`;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;

async function sendTestEmail(request, to) {
  return request.post(FN_URL, {
    headers: { Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
    data: {
      to,
      title: 'Panafide automated delivery test',
      body: 'Automated test email from tests/email-delivery-smoke.spec.js — safe to ignore.',
    },
  });
}

// Resend processes the send asynchronously — poll its own status endpoint
// rather than assuming the event has landed immediately.
async function pollResendStatus(request, id, { timeoutMs = 15000, intervalMs = 1500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const res = await request.get(`https://api.resend.com/emails/${id}`, {
      headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
    });
    if (res.ok()) {
      const json = await res.json();
      last = json.last_event;
      if (last && last !== 'sent' && last !== 'queued') return last;
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return last;
}

test.describe('send-notification-email — real delivery smoke test', () => {
  test.skip(!ANON_KEY || !RESEND_API_KEY, 'Requires VITE_SUPABASE_ANON_KEY and RESEND_API_KEY in .env');

  test('a real send to Resend is accepted and eventually marked delivered', async ({ request }) => {
    const res = await sendTestEmail(request, 'delivered@resend.dev');
    expect(res.ok()).toBeTruthy();

    const json = await res.json();
    expect(json.sent).toBe(1);
    expect(json.failed).toBe(0);
    expect(json.results[0].ok).toBe(true);
    expect(json.results[0].id).toBeTruthy();

    const status = await pollResendStatus(request, json.results[0].id);
    expect(status).toBe('delivered');
  });

  test('a bounce is accepted by the send call, and shows up as bounced on Resend', async ({ request }) => {
    const res = await sendTestEmail(request, 'bounced@resend.dev');
    expect(res.ok()).toBeTruthy();

    const json = await res.json();
    // Resend accepts the send synchronously regardless of eventual outcome —
    // the bounce only shows up as a later status transition, not a rejected
    // API call. Our function has no bounce-handling logic today; this test
    // exists to make that visible/intentional rather than an untested gap.
    expect(json.results[0].ok).toBe(true);

    const status = await pollResendStatus(request, json.results[0].id);
    expect(status).toBe('bounced');
  });
});
