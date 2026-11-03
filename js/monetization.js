/* Monetization & Stripe Logic */
import { currentUser } from './state.js';
import { Modal } from './modal.js';
import { supabase } from './supabase-client.js';
import { Bus, BUS_EVENT } from './bus.js';
import { requiredTier } from './gated-feature.js';
import { show, hide } from './dom.js';

let upgradeModal, congratsModal, upgradePanel, congratsPanel, upgradeTitleText;

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

    closeUpgradeBtn?.addEventListener('click', closeUpgradeModal);
    closeCongratsBtn?.addEventListener('click', closeCongratsModal);
    startGroovingBtn?.addEventListener('click', closeCongratsModal);


    checkoutBtn?.addEventListener('click', () => handleUpgradeClick(checkoutBtn));

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

    // Pro isn't sold yet: Pro features are granted by hand during early access.
    const isPro = !!feature && requiredTier(feature) === 'pro';
    const plusOnly = upgradeModal.querySelectorAll('.pro-bundle-header, .feature-list, .upgrade-cta');
    plusOnly.forEach(el => (isPro ? hide(el) : show(el)));
    if (title) title.textContent = isPro ? 'Panafide Pro: Early Access' : upgradeTitleText;

    if (intro && isPro) {
        intro.innerHTML = `<strong>${featureName}</strong> is part of <strong>Pro</strong>, which is in early access. Get in touch and we'll set you up.`;
    } else if (intro && featureName) {
        intro.innerHTML = `Get instant access to <strong>${featureName}</strong>, and everything else in <strong>Player+</strong> by upgrading today!`;
    }

    upgradePanel.open();
}

function closeUpgradeModal() {
    upgradePanel?.close();
}

function openCongratsModal() {
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
    }
}

async function handleUpgradeClick(btn) {
    if (!currentUser) {
        await alert("Please sign in or register to upgrade to Player+.");
        Bus.emit(BUS_EVENT.OPEN_AUTH_MODAL);
        closeUpgradeModal();
        return;
    }

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
            btn.textContent = "Upgrade to Player+";
        }
    }
}
