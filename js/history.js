/**
 * HISTORY MANAGER
 * Handles Undo/Redo functionality by taking snapshots of the pattern state.
 */

const HistoryManager = {
  undoStack: [],
  redoStack: [],
  maxHistory: 50,

  // Initialize (Keyboard Shortcuts)
  init() {
    window.addEventListener('keydown', (e) => {
      // Cmd+Z or Ctrl+Z
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          this.redo();
        } else {
          this.undo();
        }
      }
      // Cmd+Y or Ctrl+Y (Common Redo alternative)
      if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
        e.preventDefault();
        this.redo();
      }
    });
    this.updateUI();
  },

  // Save current state BEFORE a change
  pushState() {
    if (typeof serializePattern !== 'function') return;

    const currentState = serializePattern();

    // Avoid duplicates (optional, but good for messy inputs)
    // Simple JSON string comparison is fast enough for this data size
    // const last = this.undoStack[this.undoStack.length - 1];
    // if (last && JSON.stringify(last) === JSON.stringify(currentState)) return;

    this.undoStack.push(currentState);

    // Limit stack size
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }

    // New change invalidates redo path
    this.redoStack = [];

    this.updateUI();
    // console.log('History Pushed. Stack:', this.undoStack.length);
  },

  undo() {
    if (this.undoStack.length === 0) return;

    // 1. Snapshot CURRENT state to Redo Stack (so we can redo back to it)
    const currentState = serializePattern();
    this.redoStack.push(currentState);

    // 2. Pop previous state
    const prevState = this.undoStack.pop();

    // 3. Apply
    if (typeof applyPattern === 'function') {
      applyPattern(prevState);
    }

    this.updateUI();
    // console.log('Undo. Stack:', this.undoStack.length);
  },

  redo() {
    if (this.redoStack.length === 0) return;

    // 1. Snapshot CURRENT state to Undo Stack
    const currentState = serializePattern();
    this.undoStack.push(currentState);

    // 2. Pop future state
    const nextState = this.redoStack.pop();

    // 3. Apply
    if (typeof applyPattern === 'function') {
      applyPattern(nextState);
    }

    this.updateUI();
    // console.log('Redo. Stack:', this.undoStack.length);
  },

  updateUI() {
    const undoBtn = document.getElementById('undoBtn');
    const redoBtn = document.getElementById('redoBtn');

    if (undoBtn) undoBtn.disabled = (this.undoStack.length === 0);
    if (redoBtn) redoBtn.disabled = (this.redoStack.length === 0);
  }
};

// Auto-init if DOM ready, or wait
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => HistoryManager.init());
} else {
  HistoryManager.init();
}

// Export global for easy access
window.HistoryManager = HistoryManager;
