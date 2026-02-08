import { serializePattern, applyPattern } from './pattern-crud.js';

export const HistoryManager = {
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

    this.undoStack.push(currentState);

    // Limit stack size
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }

    // New change invalidates redo path
    this.redoStack = [];

    this.updateUI();
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
  },

  updateUI() {
    const undoBtn = document.getElementById('undoBtn');
    const redoBtn = document.getElementById('redoBtn');

    if (undoBtn) undoBtn.disabled = (this.undoStack.length === 0);
    if (redoBtn) redoBtn.disabled = (this.redoStack.length === 0);
  }
};
