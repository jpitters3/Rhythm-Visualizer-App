// Web Push subscription management. The VAPID public key below is, by
// design, not a secret — only the matching private key (held server-side,
// in send-practice-reminders' VAPID_PRIVATE_KEY secret) can sign pushes.
import { supabase } from './supabase-client.js';
import { currentUser } from './state.js';

const VAPID_PUBLIC_KEY = 'BE2uOLIH30PFszVcBBWKXqV6-T2OPMoP8YdQ-Vj38rbTYP5yZbDT2xko-_OpX4rTvYRMsX7vWNEuS1icNPdO4gE';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function isPushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function getExistingSubscription() {
  if (!isPushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

/**
 * Requests notification permission (if needed) and subscribes this
 * device/browser to push. Returns true on success, false otherwise —
 * never throws, so callers can just check the boolean.
 */
export async function subscribeToPush() {
  if (!isPushSupported() || !currentUser) return false;

  try {
    if (Notification.permission === 'denied') return false;
    if (Notification.permission !== 'granted') {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return false;
    }

    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }

    const { p256dh, auth } = sub.toJSON().keys;
    const { error } = await supabase.from('push_subscriptions').upsert({
      user_id: currentUser.id,
      endpoint: sub.endpoint,
      p256dh,
      auth,
    }, { onConflict: 'endpoint' });

    if (error) { console.error('[Push] Failed to save subscription:', error); return false; }
    return true;
  } catch (err) {
    console.error('[Push] Subscribe failed:', err);
    return false;
  }
}
