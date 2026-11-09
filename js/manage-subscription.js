/* Manage subscription: pause, resume, renew, cancel (via Stripe) */
import { Modal } from './modal.js';
import { supabase } from './supabase-client.js';
import { Bus, BUS_EVENT } from './bus.js';
import { currentProfile, loadCurrentProfile } from './profile.js';
import { alert } from './alert.js';
import { showToast } from './toast.js';

const LIVE_STATUSES = ['active', 'canceling', 'paused'];

let modalEl, panel, pauseMonths = 1;

// True for members billed through Stripe, including paused ones whose paid time has run out.
export function hasStripeSubscription(profile = currentProfile) {
  return profile?.subscription_source === 'stripe'
    && !!profile.stripe_customer_id
    && LIVE_STATUSES.includes(profile.subscription_status);
}

export function initManageSubscription() {
  modalEl = document.getElementById('manageSubModal');
  if (!modalEl) return;
  panel = new Modal(modalEl);

  document.getElementById('closeManageSubBtn')?.addEventListener('click', () => panel.close());
  document.querySelectorAll('[data-open-manage-sub]').forEach(btn =>
    btn.addEventListener('click', openManageSubscription));
  modalEl.querySelectorAll('[data-sub-view-open]').forEach(btn =>
    btn.addEventListener('click', () => showView(btn.dataset.subViewOpen)));
  modalEl.querySelectorAll('[data-sub-action]').forEach(btn =>
    btn.addEventListener('click', () => runAction(btn.dataset.subAction, btn)));
  modalEl.querySelectorAll('[data-pause-months]').forEach(btn =>
    btn.addEventListener('click', () => selectPauseMonths(Number(btn.dataset.pauseMonths))));

  Bus.on(BUS_EVENT.SHOW_MANAGE_SUBSCRIPTION, openManageSubscription);
  Bus.on(BUS_EVENT.PROFILE_LOADED, (e) => updateMenuButton(e.detail?.profile));
  updateMenuButton(currentProfile);

  handleStripeReturn();
}

export function openManageSubscription() {
  if (!panel || !hasStripeSubscription()) return;
  render();
  showView('main');
  panel.open();
}

function updateMenuButton(profile) {
  document.getElementById('manageSubBtn')?.toggleAttribute('hidden', !hasStripeSubscription(profile));
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function render() {
  const { subscription_status: status, subscription_expires_at: expires, subscription_resumes_at: resumes } = currentProfile;
  const paidThrough = expires && new Date(expires) > new Date();
  const statusEl = document.getElementById('manageSubStatus');

  if (status === 'canceling') {
    statusEl.textContent = `Your subscription has been cancelled. Your Panafide+ benefits end on ${formatDate(expires)}.`;
  } else if (status === 'paused') {
    // resumes_at is set an hour before the renewal; that renewal date is what members care about.
    const restarts = resumes ? formatDate(new Date(resumes).getTime() + 3600000) : null;
    statusEl.textContent = [
      paidThrough ? `You're on Panafide+ until ${formatDate(expires)}.` : 'Everything you made is still saved.',
      restarts ? `Your subscription has been paused until ${restarts}.` : 'Your subscription has been paused.',
    ].join(' ');
  } else {
    statusEl.textContent = expires ? `You're on Panafide+. It renews on ${formatDate(expires)}.` : "You're on Panafide+.";
  }

  const visible = { renew: status === 'canceling', resume: status === 'paused' };
  modalEl.querySelectorAll('[data-sub-action="renew"], [data-sub-action="resume"]').forEach(btn =>
    btn.toggleAttribute('hidden', !visible[btn.dataset.subAction]));
  modalEl.querySelectorAll('[data-sub-when]').forEach(btn =>
    btn.toggleAttribute('hidden', btn.dataset.subWhen !== status));
  selectPauseMonths(pauseMonths);
}

function showView(name) {
  modalEl.querySelectorAll('[data-sub-view]').forEach(view =>
    view.toggleAttribute('hidden', view.dataset.subView !== name));
}

function selectPauseMonths(months) {
  pauseMonths = months;
  modalEl.querySelectorAll('[data-pause-months]').forEach(btn =>
    btn.setAttribute('aria-pressed', String(Number(btn.dataset.pauseMonths) === months)));
  const expires = currentProfile?.subscription_expires_at;
  const note = document.getElementById('manageSubPauseNote');
  if (note && expires) {
    const restart = new Date(expires);
    restart.setMonth(restart.getMonth() + months);
    note.textContent = `You keep Panafide+ until ${formatDate(expires)}, then pay nothing until ${formatDate(restart)}.`;
  }
}

async function callSubscription(action, extra = {}) {
  const { data, error } = await supabase.functions.invoke('stripe-subscription', {
    body: { action, returnUrl: window.location.origin + window.location.pathname, ...extra },
  });
  if (error) {
    const message = await error.context?.json?.().then(body => body.error).catch(() => null);
    throw new Error(message || error.message);
  }
  return data;
}

const SUCCESS_MESSAGE = {
  pause: 'Your subscription is paused.',
  resume: 'Welcome back! Panafide+ is active again.',
  renew: 'Your subscription will continue.',
};

async function runAction(action, btn) {
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'One moment...';
  try {
    const data = await callSubscription(action, action === 'pause' ? { months: pauseMonths } : {});
    if (data?.url) {
      window.location.href = data.url;
      return;
    }
    await loadCurrentProfile({ refresh: true });
    render();
    showView('main');
    showToast(SUCCESS_MESSAGE[action], { type: 'success' });
  } catch (err) {
    console.error('[manage-subscription]', action, err);
    await alert(`Sorry, that didn't work: ${err.message}`);
  }
  btn.disabled = false;
  btn.textContent = label;
}

// Back from Stripe's pages: pull the new state straight from Stripe, not the webhook.
async function handleStripeReturn() {
  const url = new URL(window.location);
  const result = url.searchParams.get('subscription');
  if (!result) return;
  url.searchParams.delete('subscription');
  window.history.replaceState({}, '', url);
  if (!currentProfile) await profileLoaded();

  try {
    await callSubscription('sync');
    await loadCurrentProfile({ refresh: true });
  } catch (err) {
    console.error('[manage-subscription] sync after Stripe return', err);
  }
  if (result === 'canceled') openManageSubscription();
}

function profileLoaded() {
  return new Promise(resolve => {
    const done = () => { Bus.off(BUS_EVENT.PROFILE_LOADED, done); resolve(); };
    Bus.on(BUS_EVENT.PROFILE_LOADED, done);
  });
}
