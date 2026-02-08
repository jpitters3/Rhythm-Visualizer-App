import { SCALES } from './config.js';
import { currentUser } from './state.js';
import { innerLabels, setInnerLabels, measures, setMeasures } from './state.js';
import { renderAllMeasures } from './notegrid.js';
import { supabase } from './supabase-client.js';
import { gridA } from './grid-context.js';

class AiAssistant {
  constructor() {
    this.isOpen = false;
    this.chatContainer = document.getElementById('aiChatContainer');
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
    // Try to fetch key immediately if user is already logged in?
    // We can also retry when they open the chat.
    await this.fetchApiKeyFromDB();

    // Toggle Chat
    this.cursor?.addEventListener('click', () => {
      this.toggleChat();
      if (!this.dbKey) this.fetchApiKeyFromDB(); // Retry on open
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
        this.checkApiKeyAndWelcome();
      }
    }, 500);
  }

  async fetchApiKeyFromDB() {
    if (this.dbKey) return; // already have it

    // Check if Supabase client exists
    if (typeof supabase === 'undefined') {
      console.warn("Supabase client not validation yet.");
      return;
    }

    // We can only read if authenticated (per our RLS policy)
    // But currentUser might be null on page load.
    // We'll try anyway; if RLS fails (null data), we handle it.
    try {
      const { data, error } = await supabase
        .from('app_config')
        .select('value')
        .eq('key', 'gemini_api_key')
        .maybeSingle();

      if (error) {
        console.warn("Error fetching AI key:", error.message);
        return;
      }

      if (data && data.value) {
        this.dbKey = data.value;
        console.log("AI Assistant: API Key loaded from DB");
        // If we were waiting for a key, update UI
        if (this.waitingForKey) {
          this.waitingForKey = false;
          this.addMessage("bot", "I've connected to the cloud! How can I help you?");
        }
      }
    } catch (err) {
      console.warn("Exception fetching AI key:", err);
    }
  }

  checkApiKeyAndWelcome() {
    // Priority: DB Key -> Local Storage -> Manual Input
    const key = this.dbKey || localStorage.getItem('gemini_api_key');

    if (!key) {
      this.addMessage("bot", "Hi! I'm your rhythm assistant. To get started, please sign in so I can access the cloud.");
      this.waitingForKey = true;
    } else {
      this.addMessage("bot", "Hi! I'm your rhythm assistant. Tell me what kind of section you want (e.g., 'happy', 'melancholic', 'fast').");
      this.waitingForKey = false;
    }
  }

  toggleChat(forceState) {
    if (typeof forceState === 'boolean') {
      this.isOpen = forceState;
    } else {
      this.isOpen = !this.isOpen;
    }

    if (this.isOpen) {
      this.chatContainer.classList.add('open');
      this.input.focus();
      // Refresh suggestions (remove old, add new to trigger animation)
      this.refreshSuggestions();
    } else {
      this.chatContainer.classList.remove('open');
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
      "Add a happy chord progression with chords on the '1' beat only, and no melody",
      "Add a sad melody that repeats every 16 beats",
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
    // Mask API key in UI if it looks like one (simple check)
    if (this.waitingForKey && text.length > 20) {
      this.addMessage('user', "••••••••••••••••••••");
    } else {
      this.addMessage('user', text);
    }

    this.input.value = '';

    if (this.waitingForKey) {
      localStorage.setItem('gemini_api_key', text);
      this.waitingForKey = false;
      this.addMessage('bot', "API Key saved! How can I help you with your composition?");
      return;
    }

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
      // 1. Get Key
      const apiKey = this.dbKey || localStorage.getItem('gemini_api_key');

      if (!apiKey) {
        this.messagesArea.removeChild(loadingMsg);

        // If not logged in, maybe prompt
        if (!currentUser) {
          this.addMessage('bot', "Please sign in to use the Cloud Assistant.");
        } else {
          this.addMessage('bot', "I couldn't find the configuration. Please check your network or contact admin.");
          this.waitingForKey = true; // Fallback to asking
        }

        this.isProcessing = false;
        return;
      }

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

      // 3. Call Gemini with Fallback
      // 3. Call Gemini with Robust Fallback
      // We try different models and API versions to find one that works.
      const candidates = [
        { model: 'gemini-2.5-flash', version: 'v1beta' },
        { model: 'gemini-2.5-flash-latest', version: 'v1beta' },
        { model: 'gemini-pro', version: 'v1' }, // Stable v1 often works best for older keys
        { model: 'gemini-2.5-pro', version: 'v1beta' },
        { model: 'gemini-2.5-flash-8b', version: 'v1beta' }
      ];

      let data = null;
      let usedModel = '';

      for (const candidate of candidates) {
        const { model, version } = candidate;
        try {
          const url = `https://generativelanguage.googleapis.com/${version}/models/${model}:generateContent?key=${apiKey}`;

          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: systemPrompt }] }]
            })
          });

          const result = await response.json();

          if (result.error) {
            console.warn(`[AI] ${model} failed:`, result.error.message);

            // If it's a "Not Found" or "Not Supported", we simply continue to the next candidate
            const msg = result.error.message.toLowerCase();
            if (result.error.code === 404 || msg.includes('not found') || msg.includes('not supported')) {
              continue;
            }
            // If it's a permission/key error, we should probably stop and let the outer catch handle it, 
            // BUT we re-throw to let the catch block decide.
            throw result.error;
          }

          data = result;
          usedModel = model;
          break; // Success!

        } catch (e) {
          // Check if it's a critical auth error
          if (e.code === 401 || e.code === 403 || e.status === 'PERMISSION_DENIED' || e.status === 'INVALID_ARGUMENT') {
            // If "not found" was buried in a 400, strictly continue, otherwise throw
            const msg = (e.message || '').toLowerCase();
            if (!msg.includes('not found')) throw e;
          }
          console.warn(`[AI] Network/Other error for ${model}`, e);
        }
      }

      this.messagesArea.removeChild(loadingMsg);
      this.isProcessing = false;

      if (!data) {
        this.addMessage('bot', "I couldn't connect to any AI model. Please check your internet or API Key permissions.");
        return;
      }

      if (data.error) {
        // Should be caught above, but just in case of logic slip
        throw data.error;
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

      if (err.code === 401 || err.status === 'INVALID_ARGUMENT') {
        this.addMessage('bot', "The API Key seems invalid. Please paste it again.");
        localStorage.removeItem('gemini_api_key');
        this.waitingForKey = true;
      } else {
        this.addMessage('bot', `Error: ${err.message || 'Network error'}`);
      }
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

    // 1. Extend innerLabels
    // Ensure innerLabels is defined in grid context
    if (!gridA.innerLabels) gridA.innerLabels = [];

    // We append to the global innerLabels
    // pattern.labels should be an array.
    setInnerLabels(innerLabels.concat(pattern.labels));

    // 2. Recalculate 'measures' count
    // STEPS is defined in rhythm-core usually, or assume 16
    const stepCount = 16;
    const newMeasures = Math.ceil(innerLabels.length / stepCount);
    setMeasures(newMeasures);

    // 3. Render
    if (typeof renderAllMeasures === 'function') {
      renderAllMeasures();
    } else {
      console.warn("renderAllMeasures not found!");
    }

    // Scroll to bottom
    const measuresEl = document.getElementById('measures');
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
