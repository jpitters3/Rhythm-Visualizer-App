/* Monetization & Stripe Logic */
import { currentUser } from './state.js';
import { supabase } from './supabase-client.js';
import { Bus, BUS_EVENT } from './bus.js';

const upgradeModal = document.getElementById('upgradeModal');
const closeUpgradeBtn = document.getElementById('closeUpgradeBtn');
const checkoutBtn = document.getElementById('checkoutBtn');
const congratsModal = document.getElementById('congratsModal');
const closeCongratsBtn = document.getElementById('closeCongratsBtn');
const startGroovingBtn = document.getElementById('startGroovingBtn');

export function initMonetization() {
    // Listen for Gating Events via Bus
    Bus.on(BUS_EVENT.SHOW_UPGRADE_MODAL, (e) => {
        const feature = e.detail; // Now sends the whole GatedFeature object
        openUpgradeModal(feature);
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

    checkoutBtn?.addEventListener('click', handleUpgradeClick);

    // Check for success redirect
    checkUpgradeSuccess();
}

function openUpgradeModal(feature) {
    if (!upgradeModal) return;
    
    const featureName = (typeof feature === 'string') ? feature : feature?.getName?.() || feature?.name;

    // Update title or description if needed based on feature
    const intro = upgradeModal.querySelector('.upgrade-intro');
    if (intro && featureName) {
        intro.innerHTML = `You've reached a feature reserved for <strong>GroovePan Pro</strong> members: <em>${featureName}</em>`;
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
    
    // Confetti or celebratory effects could go here
    console.log("Congrats! You're a Pro member now.");
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
        // Force refresh profile/state to see new status
        Bus.emit(BUS_EVENT.PROFILE_LOAD_NEEDED);
    }
}

async function handleUpgradeClick() {
    if (!currentUser) {
        alert("Please sign in or register to upgrade to Pro.");
        // Redirect to auth via Bus
        Bus.emit(BUS_EVENT.OPEN_AUTH_MODAL);
        closeUpgradeModal();
        return;
    }

    checkoutBtn.disabled = true;
    checkoutBtn.textContent = "Connecting to Stripe...";

    try {
        // Call Supabase Edge Function to get Stripe Checkout URL
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
        alert("Sorry, we couldn't start the checkout process. Please try again later.");
        checkoutBtn.disabled = false;
        checkoutBtn.textContent = "Upgrade to Pro";
    }
}
