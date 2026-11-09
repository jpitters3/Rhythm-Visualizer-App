/* Monetization & Stripe Logic */
import { currentUser } from './state.js';
import { Modal } from './modal.js';
import { supabase } from './supabase-client.js';
import { Bus, BUS_EVENT } from './bus.js';
import { currentProfile } from './profile.js';
import { requiredTier } from './gated-feature.js';
import { show, hide } from './dom.js';
import { initPlans } from './plans.js';
import { hasStripeSubscription, openManageSubscription } from './manage-subscription.js';

let upgradeModal, congratsModal, upgradePanel, congratsPanel, congratsText, upgradeTitleText;

export function initMonetization() {
    // Late-bound DOM references
    upgradeModal = document.getElementById('upgradeModal');
    const closeUpgradeBtn = document.getElementById('closeUpgradeBtn');
    const checkoutBtn = document.getElementById('checkoutBtn');
    congratsModal = document.getElementById('congratsModal');
    const closeCongratsBtn = document.getElementById('closeCongratsBtn');
    const startGroovingBtn = document.getElementById('startGroovingBtn');
    upgradePanel = new Modal(upgradeModal);
    congratsPanel = new Modal(congratsModal, { onClose: () => {
      const url = new URL(window.location);
      url.searchParams.delete('upgrade');
      window.history.replaceState({}, '', url);
    }});

    // Listen for Gating Events via Bus
    Bus.on(BUS_EVENT.SHOW_UPGRADE_MODAL, (e) => {
        // detail can be the feature object itself or a string/object containing { feature, featureId }
        const payload = e.detail;
        openUpgradeModal(payload);
    });

    Bus.on(BUS_EVENT.SHOW_CONGRATS_MODAL, openCongratsModal);
    Bus.on(BUS_EVENT.PROFILE_LOADED, (e) => showProgramWelcome(e.detail?.profile));
    showProgramWelcome(currentProfile); // the profile can load before this init runs

    closeUpgradeBtn?.addEventListener('click', closeUpgradeModal);
    closeCongratsBtn?.addEventListener('click', closeCongratsModal);
    startGroovingBtn?.addEventListener('click', closeCongratsModal);


    checkoutBtn?.addEventListener('click', () => handleUpgradeClick(checkoutBtn));
    initPlans({ onUpgrade: handleUpgradeClick });

    // Check for success redirect
    checkUpgradeSuccess();
}

function openUpgradeModal(payload) {
    if (!upgradeModal) return;

    // Support both direct feature object or payload { feature, featureId }
    const feature = payload?.feature || payload;
    const featureId = payload?.featureId;

    const featureName = (typeof feature === 'string') ? feature : feature?.getName?.() || feature?.name;

    // Clear previous highlights
    upgradeModal.querySelectorAll('.feature-item').forEach(item => item.classList.remove('highlight'));

    // Apply new highlight if ID provided
    if (featureId) {
        const target = document.getElementById(featureId);
        if (target) {
            target.classList.add('highlight');
            // Ensure visible if modal content is long (though current isn't)
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    // Update title or description based on feature
    const title = upgradeModal.querySelector('.modal-title');
    const intro = upgradeModal.querySelector('.upgrade-intro');
    upgradeTitleText ??= title?.textContent;

    // Pro isn't sold yet; private clients get it through their program.
    const isPro = !!feature && requiredTier(feature) === 'pro';
    const plusOnly = upgradeModal.querySelectorAll('.pro-bundle-header, .feature-list, .upgrade-cta');
    plusOnly.forEach(el => (isPro ? hide(el) : show(el)));
    if (title) title.textContent = isPro ? 'Panafide Pro: Coming Soon' : upgradeTitleText;

    if (intro && isPro) {
        intro.innerHTML = `<strong>${featureName}</strong> is part of <strong>Panafide Pro</strong>, which is coming soon.`;
    } else if (intro && featureName) {
        intro.innerHTML = `Get instant access to <strong>${featureName}</strong>, and everything else in <strong>Panafide+</strong> by upgrading today!`;
    }

    upgradePanel.open();
}

function closeUpgradeModal() {
    upgradePanel?.close();
}

function congratsElements() {
    return {
        title: congratsModal?.querySelector('.modal-title'),
        intro: congratsModal?.querySelector('.upgrade-intro'),
    };
}

function openCongratsModal() {
    // Restore the Stripe-upgrade wording if the program welcome changed it.
    const { title, intro } = congratsElements();
    if (congratsText && title && intro) {
        title.textContent = congratsText.title;
        intro.textContent = congratsText.intro;
    }
    congratsPanel?.open();
}

// Once per user: Plus that came with a group or private program.
function showProgramWelcome(profile) {
    const tier = profile?.subscription_tier;
    if (profile?.subscription_source !== 'tekmatix' || (tier !== 'player_plus' && tier !== 'pro')) return;
    if (!profile.subscription_expires_at || new Date(profile.subscription_expires_at) <= new Date()) return;
    if (congratsModal?.classList.contains('open')) return;

    const key = `plus_program_welcome_${profile.user_id}`;
    try {
        if (localStorage.getItem(key)) return;
        localStorage.setItem(key, new Date().toISOString());
    } catch { /* storage blocked: show it anyway */ }

    const { title, intro } = congratsElements();
    if (!title || !intro) return;
    congratsText ??= { title: title.textContent, intro: intro.textContent };
    const tierName = tier === 'pro' ? 'Panafide Pro' : 'Panafide+';
    title.textContent = `${tierName} is included with your program! 🎉`;
    intro.textContent = tier === 'pro'
        ? 'As a private student, you have everything in Panafide Pro for as long as you\'re enrolled, including the AI Assistant and early access to new features. Here\'s what else you\'ve unlocked:'
        : 'As a group student, you have everything in Panafide+ for as long as you\'re enrolled. Here\'s what you\'ve unlocked:';
    congratsPanel?.open();
}

function closeCongratsModal() {
    congratsPanel?.close();
}

function checkUpgradeSuccess() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('upgrade') === 'success') {
        openCongratsModal();
        Bus.emit(BUS_EVENT.PROFILE_LOAD_NEEDED);
    } else if (params.get('upgrade') === 'cancel') {
        // Back from Stripe without paying: just tidy the URL.
        const url = new URL(window.location);
        url.searchParams.delete('upgrade');
        window.history.replaceState({}, '', url);
    }
}

async function handleUpgradeClick(btn) {
    if (!currentUser) {
        await alert("Please sign in or register to upgrade to Panafide+.");
        Bus.emit(BUS_EVENT.OPEN_AUTH_MODAL);
        closeUpgradeModal();
        return;
    }
    if (hasStripeSubscription()) {
        closeUpgradeModal();
        openManageSubscription();
        return;
    }

    const label = btn?.textContent;
    if (btn) {
        btn.disabled = true;
        btn.textContent = "Connecting to Stripe...";
    }

    try {
        const { data, error } = await supabase.functions.invoke('stripe-checkout', {
            body: { 
                userId: currentUser.id,
                email: currentUser.email,
                returnUrl: window.location.origin + window.location.pathname
            }
        });

        if (error) throw error;

        if (data?.url) {
            window.location.href = data.url;
        } else {
            throw new Error("Failed to generate checkout link.");
        }
    } catch (err) {
        console.error("Payment error:", err);
        await alert("Sorry, we couldn't start the checkout process. Please try again later.");
        if (btn) {
            btn.disabled = false;
            btn.textContent = label;
        }
    }
}
