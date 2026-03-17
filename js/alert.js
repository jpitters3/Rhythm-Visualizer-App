/**
 * CustomAlert - Direct replacement for native browser alert(), confirm(), and prompt().
 * Uses the #confirmModal DOM structure from index.html.
 */
class CustomAlert {
    constructor(id = 'confirmModal') {
        this.modal = document.getElementById(id);
        if (!this.modal) {
            console.error(`CustomAlert: Modal with ID "${id}" not found.`);
            return;
        }
        this.title = this.modal.querySelector('#confirmTitle');
        this.message = this.modal.querySelector('#confirmMessage');
        this.inputWrapper = this.modal.querySelector('#confirmInputWrapper');
        this.input = this.modal.querySelector('#confirmInput');
        this.okBtn = this.modal.querySelector('#confirmOkBtn');
        this.cancelBtn = this.modal.querySelector('#confirmCancelBtn');
        this.resolve = null;

        this.init();
    }

    init() {
        // Handle OK button
        this.okBtn.addEventListener('click', () => {
            const value = this.inputWrapper.style.display === 'block' ? this.input.value : true;
            this.hide(value);
        });

        // Handle Cancel button
        this.cancelBtn.addEventListener('click', () => {
            const value = this.inputWrapper.style.display === 'block' ? null : false;
            this.hide(value);
        });

        // Close on Escape or click outside
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.modal.classList.contains('open')) {
                this.cancelBtn.click();
            }
        });

        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) {
                this.cancelBtn.click();
            }
        });
    }

    /**
     * Show the alert/confirm/prompt.
     * @param {Object} options 
     * @returns {Promise<any>}
     */
    show({ type = 'alert', title = 'Alert', message = '', placeholder = 'Enter value...', defaultValue = '', confirmText = 'OK', cancelText = 'Cancel' } = {}) {
        return new Promise((resolve) => {
            this.resolve = resolve;
            
            this.title.textContent = title;
            this.message.textContent = message;
            this.okBtn.textContent = confirmText;
            this.cancelBtn.textContent = cancelText;

            // Reset Input
            this.inputWrapper.style.display = type === 'prompt' ? 'block' : 'none';
            if (type === 'prompt') {
                this.input.placeholder = placeholder;
                this.input.value = defaultValue;
                setTimeout(() => this.input.focus(), 100);
            }

            // Toggle Cancel Button
            this.cancelBtn.style.display = type === 'alert' ? 'none' : 'inline-block';

            // Show Modal
            this.modal.classList.add('open');
            this.modal.setAttribute('aria-hidden', 'false');
        });
    }

    hide(value) {
        if (!this.modal.classList.contains('open')) return;
        
        this.modal.classList.remove('open');
        this.modal.setAttribute('aria-hidden', 'true');
        
        if (this.resolve) {
            this.resolve(value);
            this.resolve = null;
        }
    }
}

// Initialize singleton instance
const alertInstance = new CustomAlert();

// Export as async functions to mimic native behavior (requiring await)
export const alert = (message, title = 'Panafide') => alertInstance.show({ type: 'alert', title, message });
export const confirm = (message, title = 'Panafide') => alertInstance.show({ type: 'confirm', title, message });
export const prompt = (message, defaultValue = '', title = 'Panafide') => alertInstance.show({ type: 'prompt', title, message, defaultValue });

// Also expose globally for legacy scripts not using modules yet
window._customAlert = alert;
window._customConfirm = confirm;
window._customPrompt = prompt;

export default CustomAlert;
