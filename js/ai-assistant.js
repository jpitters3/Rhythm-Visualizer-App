import { gridA } from './grid-context.js';
import { canAccess, FEATURE } from './gated-feature.js';
import { Bus, BUS_EVENT } from './bus.js';
import { supabase } from './supabase-client.js';
import { SCALES } from './config.js';
import { renderAllMeasures } from './notegrid.js';
import { Sidepanel } from './sidepanel.js';

class AiAssistant {
  constructor() {
    this.isOpen = false;
    this.chatContainer = document.getElementById('aiChatContainer');
    this.sidePanel = new Sidepanel(this.chatContainer);
    this.cursor = document.getElementById('aiFab');
    this.input = document.getElementById('aiInput');
    this.messagesArea = document.querySelector('.ai-messages');

    // API KEY CONFIGURATION
    // Fetched from Supabase for authenticated users
    this.dbKey = null;

    this.isProcessing = false;
    this.waitingForKey = false;

    this.init();
  }

  async init() {
    // Toggle Chat
    this.cursor?.addEventListener('click', () => {
      this.toggleChat();
    });

    // Send Message
    document.getElementById('sendAiBtn')?.addEventListener('click', () => this.handleSend());
    this.input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.handleSend();
    });

    // Close
    document.querySelector('.close-ai-btn')?.addEventListener('click', () => this.toggleChat(false));

    // Initial Welcome
    setTimeout(() => {
      if (this.messagesArea && this.messagesArea.children.length === 0) {
        this.addMessage("bot", "Hi! I'm your composition assistant. Tell me what kind of section you want (e.g., 'happy', 'melancholic', 'fast').");
      }
    }, 500);
  }

  toggleChat(forceState) {
    if (!canAccess(FEATURE.AI_ASSISTANT)) {
      // Trigger upgrade modal via Bus
      Bus.emit(BUS_EVENT.SHOW_UPGRADE_MODAL, {
        feature: FEATURE.AI_ASSISTANT,
        featureId: 'feat-composition'
      });
      return;
    }

    const nextState = (typeof forceState === 'boolean') ? forceState : !this.sidePanel.isOpen;

    if (nextState) {
      this.sidePanel.open();
      this.input.focus();
      // Refresh suggestions (remove old, add new to trigger animation)
      this.refreshSuggestions();
    } else {
      this.sidePanel.close();
    }
  }

  refreshSuggestions() {
    // Remove any existing suggestion containers to avoid duplicates/stacking
    const existing = this.messagesArea.querySelectorAll('.suggestion-chips');
    existing.forEach(el => el.remove());

    // Add fresh suggestions
    this.addSuggestions();
  }

  addSuggestions() {
    const suggestions = [
      "Add a happy progression with chords on the '1' beat",
      "Add a sad melody",
      "Add an upbeat section"
    ];

    const container = document.createElement('div');
    container.className = 'suggestion-chips';

    suggestions.forEach((text, index) => {
      const chip = document.createElement('div');
      chip.className = 'suggestion-chip';

      // Stagger animation: 100ms delay per item
      chip.style.animationDelay = `${index * 0.1}s`;

      chip.textContent = text;
      chip.title = text;
      chip.onclick = () => {
        this.input.value = text;
        this.handleSend();
        container.remove(); // Remove suggestions after selection
      };
      container.appendChild(chip);
    });

    this.messagesArea.appendChild(container);
    this.messagesArea.scrollTop = this.messagesArea.scrollHeight;
  }

  handleSend() {
    const text = this.input.value.trim();
    if (!text) return;

    // UI: User Message
    this.addMessage('user', text);
    this.input.value = '';

    this.processAiResponse(text);
  }

  addMessage(type, text, action = null) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${type}`;
    msgDiv.textContent = text;

    if (action) {
      // Create Action Button
      const btn = document.createElement('button');
      btn.className = 'ai-action-btn';
      btn.textContent = action.label;
      btn.onclick = () => {
        this.executeAction(action, btn);
      };
      msgDiv.appendChild(document.createElement('br'));
      msgDiv.appendChild(btn);
    }

    this.messagesArea.appendChild(msgDiv);
    this.messagesArea.scrollTop = this.messagesArea.scrollHeight;
  }

  async processAiResponse(userText) {
    this.isProcessing = true;
    const loadingMsg = document.createElement('div');
    loadingMsg.className = 'message bot loading';
    loadingMsg.textContent = 'Thinking...';
    this.messagesArea.appendChild(loadingMsg);
    this.messagesArea.scrollTop = this.messagesArea.scrollHeight;

    try {
      // 1. Gather Context
      const scaleSelect = document.getElementById('scaleSelect');
      const scaleName = scaleSelect ? scaleSelect.value : "D Kurd";
      // Ensure SCALES is available
      const scaleData = (typeof SCALES !== 'undefined') ? SCALES[scaleName] : null;
      const mapStr = scaleData ? JSON.stringify(scaleData.map) : "Unknown map";

      // 2. Construct Prompt
      const systemPrompt = `
You are an expert Handpan composer assistant.
The user is composing in the scale: ${scaleName}.
The notes map (Number -> Pitch) is: ${mapStr}. "D" is the Ding (center/bass).
Valid note labels are: "D", "T" (Tak), "S" (Slap), "1", "2", "3", "4", "5", "6", "7", "8".
Rest is "".

The format for patterns is a JSON object:
{
  "measures": number (usually 4),
  "labels": Array of (string | Array<string>)
}
- "labels" array length must be measures * 16.
- Each item corresponds to a 16th note step.
- An item can be a single string (single note) e.g., "1" or "D" or "T".
- An item can be an array of 4 strings for chords.
- Chord arrays are defined as [LH-Index, LH-Thumb, RH-Index, RH-Thumb].
- If a slot in the chord is empty, use "".
- Chord arrays can be either [value, value, value, ""] or [value, "", value, value].
- If left index and left thumb are both included, left index must be higher than left thumb, and their values must be no more than 2 apart.
- If right index and right thumb are both included, right index must be higher than right thumb, and their values must be no more than 2 apart.
- Don't include the ding (D) in chords.
- Don't include the tak (T) in chords.
- Don't include the slap (S) in chords.
- Example chord: ["4", "2", "6", ""] (Left index plays 4, left thumb plays 2, right index plays 6)
- Example chord: ["8", "", "5", "3"] (Left index plays 8, right index plays 5, right thumb plays 3)

User Request: "${userText}"

Task: Generate a creative, musical pattern matching the request.
Output ONLY valid JSON. No markdown formatting.
`;

      // 3. Call Supabase Edge Function
      const { data, error } = await supabase.functions.invoke('ai-assistant', {
        body: { systemPrompt }
      });

      this.messagesArea.removeChild(loadingMsg);
      this.isProcessing = false;

      if (error) {
        console.error("Edge Function Error Details:", error);
        let detailedMsg = error.message || "Unknown error";

        // If it's a FunctionsHttpError, we can try to see if there's more info
        if (error.context && typeof error.context.json === 'function') {
          try {
            const body = await error.context.json();
            detailedMsg += `: ${JSON.stringify(body)}`;
          } catch (e) { }
        }

        this.addMessage('bot', `Backend Error: ${detailedMsg}`);
        return;
      }

      if (!data) {
        this.addMessage('bot', "No response from AI. Please try again.");
        return;
      }

      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) {
        this.addMessage('bot', "I couldn't generate a response. Try again.");
        return;
      }

      // Cleanup JSON (remove markdown code blocks if present)
      const jsonStr = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
      let patternData;
      try {
        patternData = JSON.parse(jsonStr);
      } catch (e) {
        console.error("JSON Parse Error", e, jsonStr);
        this.addMessage('bot', "I generated an invalid pattern format. Please try again with a simpler request.");
        return;
      }

      // 4. Present Result
      this.addMessage('bot', `Here is a pattern for "${userText}".`, {
        type: 'APPEND_PATTERN',
        label: 'Add to Grid',
        data: patternData
      });

    } catch (err) {
      console.error(err);
      if (loadingMsg.parentNode) loadingMsg.parentNode.removeChild(loadingMsg);
      this.isProcessing = false;
      this.addMessage('bot', `System Error: ${err.message || 'Network error'}`);
    }
  }

  executeAction(action, btn) {
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Applied ✓";
    }

    if (action.type === 'CLEAR_GRID') {
      const clearBtn = document.getElementById('clearBtn');
      if (clearBtn) clearBtn.click();
    } else if (action.type === 'APPEND_PATTERN') {
      this.appendPatternToGrid(action.data);

      // Re-show suggestions after a delay
      setTimeout(() => {
        this.refreshSuggestions();
      }, 2000);
    }
  }

  appendPatternToGrid(pattern) {
    if (!pattern || !pattern.labels) return;

    // Use active grid
    const targetGrid = gridA;

    // 1. Extend innerLabels
    if (!targetGrid.innerLabels) targetGrid.innerLabels = [];

    // If grid is currently default empty, replace it, else append
    const isEmpty = targetGrid.innerLabels.every(l => l === '');

    if (isEmpty) {
      targetGrid.innerLabels = [...pattern.labels];
    } else {
      targetGrid.innerLabels = targetGrid.innerLabels.concat(pattern.labels);
    }

    // Extend innerHands to match the new length
    if (targetGrid.innerHands) {
      const diff = targetGrid.innerLabels.length - targetGrid.innerHands.length;
      if (diff > 0) {
        targetGrid.innerHands = targetGrid.innerHands.concat(Array(diff).fill(null));
      } else if (isEmpty) {
        targetGrid.innerHands = Array(targetGrid.innerLabels.length).fill(null);
      }
    }

    // 2. Render
    if (typeof renderAllMeasures === 'function') {
      renderAllMeasures(targetGrid);
    } else {
      console.warn("renderAllMeasures not found!");
    }

    // Scroll to bottom
    const measuresEl = targetGrid.container;
    if (measuresEl) {
      // Wait for DOM update
      setTimeout(() => {
        measuresEl.scrollTop = measuresEl.scrollHeight;
      }, 100);
    }
  }
}

export let aiAssistant;

export function initAiAssistant() {
  aiAssistant = new AiAssistant();
}
