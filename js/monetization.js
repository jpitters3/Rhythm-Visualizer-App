/* Monetization & Stripe Logic */
import { currentUser } from './state.js';
import { supabase } from './supabase-client.js';
import { Bus, BUS_EVENT } from './bus.js';

let upgradeModal, congratsModal;

export function initMonetization() {
    // Late-bound DOM references
    upgradeModal = document.getElementById('upgradeModal');
    const closeUpgradeBtn = document.getElementById('closeUpgradeBtn');
    const checkoutBtn = document.getElementById('checkoutBtn');
    congratsModal = document.getElementById('congratsModal');
    const closeCongratsBtn = document.getElementById('closeCongratsBtn');
    const startGroovingBtn = document.getElementById('startGroovingBtn');

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

    // Close on backdrop click for both
    window.addEventListener('click', (e) => {
        if (e.target === upgradeModal) closeUpgradeModal();
        if (e.target === congratsModal) closeCongratsModal();
    });

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
    const intro = upgradeModal.querySelector('.upgrade-intro');
    if (intro && featureName) {
        intro.innerHTML = `Get instant access to <strong>${featureName}</strong>, and everything else in the <strong>Pro Bundle</strong>, by upgrading today!`;
    }

    upgradeModal.classList.add('open');
    upgradeModal.setAttribute('aria-hidden', 'false');
}

function closeUpgradeModal() {
    if (!upgradeModal) return;
    upgradeModal.classList.remove('open');
    upgradeModal.setAttribute('aria-hidden', 'true');
}

function openCongratsModal() {
    if (!congratsModal) return;
    congratsModal.classList.add('open');
    congratsModal.setAttribute('aria-hidden', 'false');
}

function closeCongratsModal() {
    if (!congratsModal) return;
    congratsModal.classList.remove('open');
    congratsModal.setAttribute('aria-hidden', 'true');
    
    // Clean up URL to remove ?upgrade=success
    const url = new URL(window.location);
    url.searchParams.delete('upgrade');
    window.history.replaceState({}, '', url);
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
        await alert("Please sign in or register to upgrade to Pro.");
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
            btn.textContent = "Upgrade to Pro";
        }
    }
}
