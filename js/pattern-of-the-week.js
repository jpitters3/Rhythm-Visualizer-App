import { supabase } from './supabase-client.js';
import { currentUser } from './state.js';

/* POTW Dashboard Logic */
// State
let patternsCache = [];
let modal, statusMsg, patternSelect, dateInput, diffInput, descInput, scheduleBtn;
let tabs, tabContents;

let editingId = null; // ID of the weekly_pattern being edited

// --- INIT ---
export function initPOTW() {
  const potwBtn = document.getElementById('openPotwModalBtn');
  modal = document.getElementById('potwModal');
  const closeBtn = document.getElementById('closePotwBtn');
  scheduleBtn = document.getElementById('potwScheduleBtn');

  // Form Elements
  patternSelect = document.getElementById('potwPatternSelect');
  dateInput = document.getElementById('potwLaunchDate');
  diffInput = document.getElementById('potwDifficulty');
  descInput = document.getElementById('potwDesc');
  statusMsg = document.getElementById('potwStatus');

  // Tabs
  tabs = document.querySelectorAll('.potw-tab');
  tabContents = document.querySelectorAll('.potw-tab-content');

  if (potwBtn) potwBtn.addEventListener('click', openPotwModal);
  if (closeBtn) closeBtn.addEventListener('click', closePotwModal);
  if (scheduleBtn) scheduleBtn.addEventListener('click', handleSchedule);

  // Tab Listeners
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      switchTab(tab.getAttribute('data-tab'));
    });
  });

  // Expose Global Helper for List Actions
  window.potwActions = {
    editItem: editItem,
    deleteItem: deleteItem
  };
}

function switchTab(tabId) {
  if (tabId === 'potwSchedule' && !editingId) {
    // If switching to Schedule manually, clear edit state?
    // Maybe user wants to schedule NEW. 
    resetForm();
  }

  // Buttons
  tabs.forEach(t => {
    if (t.getAttribute('data-tab') === tabId) t.classList.add('active');
    else t.classList.remove('active');
  });

  // Content
  tabContents.forEach(c => {
    if (c.id === tabId) c.classList.add('active');
    else c.classList.remove('active');
  });

  // Load Data if Manage
  if (tabId === 'potwManage') {
    fetchFullSchedule();
  }
}

// --- ACTIONS ---
async function openPotwModal() {
  if (!modal) return;
  modal.style.display = 'flex';
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');

  // Reset
  if (statusMsg) statusMsg.textContent = '';
  resetForm();

  // Default Tab
  switchTab('potwSchedule');

  // Fetch Patterns if empty
  if (patternSelect.options.length <= 1) {
    await fetchPotwPatterns();
  }
}

function closePotwModal() {
  if (!modal) return;
  modal.style.display = 'none';
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  resetForm();
}

function resetForm() {
  editingId = null;
  if (scheduleBtn) {
    scheduleBtn.textContent = 'Schedule Pattern';
    scheduleBtn.classList.remove('warn-btn'); // Remove update style if any
  }

  if (dateInput) dateInput.valueAsDate = new Date(); // Default today
  if (patternSelect) patternSelect.value = "";
  if (diffInput) diffInput.value = 5;
  if (descInput) descInput.value = "";
  if (statusMsg) statusMsg.textContent = "";
}

async function fetchPotwPatterns() {
  if (!supabase || !currentUser) return;

  try {
    const { data, error } = await supabase
      .from('patterns')
      .select('id, name')
      .eq('user_id', currentUser.id)
      .order('updated_at', { ascending: false });

    if (error) throw error;

    patternsCache = data || [];

    patternSelect.innerHTML = '<option value="">-- Select Pattern --</option>';
    patternsCache.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      patternSelect.appendChild(opt);
    });

  } catch (err) {
    console.error("POTW fetch error:", err);
  }
}

async function fetchFullSchedule() {
  const upcomingEl = document.getElementById('potwUpcomingList');
  const activeEl = document.getElementById('potwActiveList');
  const historyEl = document.getElementById('potwHistoryList');

  if (!upcomingEl) return;

  upcomingEl.innerHTML = 'Loading...';
  activeEl.innerHTML = 'Loading...';
  historyEl.innerHTML = 'Loading...';

  try {
    const { data, error } = await supabase
      .from('weekly_patterns')
      .select(`
                 id, launch_date, difficulty, description, pattern_id,
                 patterns ( id, name )
             `)
      .order('launch_date', { ascending: false });

    if (error) throw error;

    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const upcoming = [];
    const active = [];
    const pastList = [];
    let foundActive = false;

    data.forEach(item => {
      const d = new Date(item.launch_date);
      // We need to pass the raw objects to renderList to support Editing
      if (d > now) {
        upcoming.push(item);
      } else {
        if (!foundActive) {
          active.push(item);
          foundActive = true;
        } else {
          pastList.push(item);
        }
      }
    });

    renderList(upcomingEl, upcoming.reverse(), "No upcoming patterns.");
    renderList(activeEl, active, "No active pattern today.");
    renderList(historyEl, pastList, "No history.");

  } catch (err) {
    console.error("Schedule Fetch Error:", err);
    upcomingEl.textContent = "Error loading.";
  }
}

function renderList(container, items, emptyText) {
  if (!items || items.length === 0) {
    container.innerHTML = `<div style="font-style:italic; opacity:0.6; padding:10px;">${emptyText}</div>`;
    return;
  }

  container.innerHTML = items.map(item => {
    const d = new Date(item.launch_date).toLocaleDateString();
    const name = item.patterns?.name || 'Unknown Pattern';

    // Escape JSON for onclick
    const itemJson = JSON.stringify(item).replace(/"/g, '&quot;');

    return `
            <div class="potw-list-item">
               <div>
                 <h4>${name} <span class="potw-diff-badge">Lvl ${item.difficulty}</span></h4>
                 <div class="meta">${d}</div>
               </div>
               <div class="potw-actions">
                 <button class="icon-btn edit-btn" onclick='window.potwActions.editItem(${itemJson})' title="Edit / Reschedule">✏️</button>
                 <button class="icon-btn delete-btn" onclick="window.potwActions.deleteItem('${item.id}')" title="Unschedule / Delete">🗑️</button>
               </div>
            </div>
         `;
  }).join('');
}

// --- CRUD OPERATIONS ---
function editItem(item) {
  editingId = item.id;

  // Populate Form
  patternSelect.value = item.pattern_id;

  // Date: ISO string to YYYY-MM-DD
  if (item.launch_date) {
    const d = new Date(item.launch_date);
    dateInput.value = d.toISOString().split('T')[0];
  }

  diffInput.value = item.difficulty || 5;
  descInput.value = item.description || "";

  // Change UI State
  scheduleBtn.textContent = "Update Schedule";
  showStatus("Editing mode active.", "");

  // Switch Tab
  // Manually trigger tab switch logic without resetting form
  tabs.forEach(t => {
    if (t.getAttribute('data-tab') === 'potwSchedule') {
      t.classList.add('active');
      // Don't call switchTab directly to avoid weird recursion or reset logic
    } else {
      t.classList.remove('active');
    }
  });
  tabContents.forEach(c => {
    if (c.id === 'potwSchedule') c.classList.add('active');
    else c.classList.remove('active');
  });
}

async function deleteItem(id) {
  if (!confirm("Are you sure you want to unschedule this pattern?")) return;

  try {
    const { error } = await supabase
      .from('weekly_patterns')
      .delete()
      .eq('id', id);

    if (error) throw error;

    fetchFullSchedule(); // Refresh list

  } catch (err) {
    alert("Error deleting: " + err.message);
  }
}

async function handleSchedule() {
  const patternId = patternSelect.value;
  const dateVal = dateInput.value;
  const diff = diffInput.value;
  const desc = descInput.value;

  if (!patternId || !dateVal) {
    showStatus("Please complete fields.", "error");
    return;
  }

  showStatus(editingId ? "Updating..." : "Scheduling...", "");

  try {
    const launchDate = new Date(dateVal).toISOString();
    const payload = {
      pattern_id: patternId,
      launch_date: launchDate,
      difficulty: parseInt(diff, 10),
      description: desc
    };

    let error;

    if (editingId) {
      // UPDATE
      const res = await supabase
        .from('weekly_patterns')
        .update(payload)
        .eq('id', editingId);
      error = res.error;
    } else {
      // INSERT
      const res = await supabase
        .from('weekly_patterns')
        .insert(payload);
      error = res.error;
    }

    if (error) throw error;

    showStatus(editingId ? "Updated successfully!" : "Scheduled successfully!", "success");

    // Reset and go to list?
    setTimeout(() => {
      resetForm();
      switchTab('potwManage'); // View the result
    }, 1000);

  } catch (err) {
    console.error(err);
    showStatus(err.message, "error");
  }
}

function showStatus(msg, type) {
  if (!statusMsg) return;
  statusMsg.textContent = msg;
  statusMsg.className = "status-msg " + (type === "error" ? "status-error" : "status-success");
}
