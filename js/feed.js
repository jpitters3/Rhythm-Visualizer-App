import { escapeHtml } from './utils.js';
import { currentUser } from './auth.js';
import { supabase } from './supabase-client.js';
import { addToPractice } from './practice.js';

// Community Feed Logic

export function loadPatternFromFeed(json, name) {
  if (confirm(`Load pattern "${name}"? Unsaved changes will be lost.`)) {
    // Assuming applyPattern is global or imported. It seems global from notegrid/controls?
    // Checking controls.js later. For now, rely on window.applyPattern if it exists, or import it.
    // applyPattern was likely a global function.
    if (window.applyPattern) {
      window.applyPattern(json);
    } else {
      console.error("applyPattern not found");
    }
    document.title = `GroovePan — ${name}`;
  }
}

const feedModal = document.getElementById('feedModal');
const closeFeedBtn = document.getElementById('closeFeedBtn');
const feedGrid = document.getElementById('feedGrid');
const feedFilterTabs = document.querySelectorAll('.feed-filter-tab'); // Inner filters

// Top Level Nav
const navCompositionsBtn = document.getElementById('navCompositionsBtn');
const navDiscussionBtn = document.getElementById('navDiscussionBtn');
const compositionsView = document.getElementById('compositionsView');
const discussionView = document.getElementById('discussionView');

let currentFeedFilter = 'newest'; // newest, top, mine

// Initial Load
document.getElementById('communityBtn')?.addEventListener('click', () => {
  openFeedModal();
});

closeFeedBtn?.addEventListener('click', () => {
  document.body.style.overflow = '';
  feedModal.classList.remove('open');
  feedModal.setAttribute('aria-hidden', 'true');
});

let compositionsLoaded = false;

// Main Tab Logic
function switchMainTab(tabName) {
  if (tabName === 'discussion') {
    navDiscussionBtn.classList.add('active');
    navCompositionsBtn.classList.remove('active');
    discussionView.style.display = 'block';
    compositionsView.style.display = 'none';

    // Lazy Init Discussion
    if (window.initCommunityPosts) window.initCommunityPosts();
  } else {
    navCompositionsBtn.classList.add('active');
    navDiscussionBtn.classList.remove('active');
    compositionsView.style.display = 'block';
    discussionView.style.display = 'none';

    // Lazy Load Compositions
    if (!compositionsLoaded) {
      fetchFeed(currentFeedFilter);
      compositionsLoaded = true;
    }
  }
}

navCompositionsBtn?.addEventListener('click', () => switchMainTab('compositions'));
navDiscussionBtn?.addEventListener('click', () => switchMainTab('discussion'));


// Tab Switching
feedFilterTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    // Update active state
    feedFilterTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');

    // Fetch
    currentFeedFilter = tab.dataset.filter;
    fetchFeed(currentFeedFilter);
  });
});

function openFeedModal() {
  document.body.style.overflow = 'hidden';
  feedModal.classList.add('open');
  feedModal.setAttribute('aria-hidden', 'false');
  // Default to Discussion
  switchMainTab('discussion');
}

async function fetchFeed(filter) {
  feedGrid.innerHTML = '<div class="loading-spinner">Loading rhythms...</div>';

  let query = supabase
    .from('shared_patterns')
    .select(`
            id, 
            name, 
            description, 
            likes_count, 
            created_at, 
            user_id, 
            pattern_json,
            profiles:profile_id (username)
        `);

  // Apply Filters
  if (filter === 'newest') {
    query = query.eq('is_public', true).order('created_at', { ascending: false });
  } else if (filter === 'top') {
    query = query.eq('is_public', true).order('likes_count', { ascending: false });
  } else if (filter === 'mine') {
    if (!currentUser) {
      feedGrid.innerHTML = '<div class="empty-state">Sign in to see your shared patterns.</div>';
      return;
    }
    // "Mine" shows everything I shared, private or public
    query = query.eq('user_id', currentUser.id).order('created_at', { ascending: false });
  }

  // Limit
  query = query.limit(50);

  const { data, error } = await query;

  if (error) {
    console.error('Feed fetch error:', error);
    feedGrid.innerHTML = `<div class="error-state">Failed to load feed: ${error.message}</div>`;
    return;
  }

  renderPatternsFeed(data);
}

function renderPatternsFeed(patterns) {
  feedGrid.innerHTML = '';

  if (!patterns || patterns.length === 0) {
    feedGrid.innerHTML = '<div class="empty-state">No patterns found in this category.</div>';
    return;
  }

  patterns.forEach(p => {
    const card = document.createElement('div');
    card.className = 'feed-card';

    const authorName = p.profiles?.username || 'Unknown';
    const isOwner = currentUser && currentUser.id === p.user_id;

    // Escape HTML to prevent XSS
    const safeName = escapeHtml(p.name);
    const safeDesc = p.description ? escapeHtml(p.description) : '';

    const deleteBtnHtml = isOwner
      ? `<button class="delete-pattern-btn" data-id="${p.id}" title="Unshare Pattern">🗑️</button>`
      : '';

    card.innerHTML = `
              <div class="feed-card-header">
                  <h3>${safeName}</h3>
                  <span class="author">by ${authorName}</span>
              </div>
              <div class="feed-card-body">
                  <p>${safeDesc}</p>
                  <div class="feed-stats">
                      <button class="like-btn" data-id="${p.id}">
                          <span class="heart-icon">♥</span> 
                          <span class="likes-count">${p.likes_count || 0}</span>
                      </button>
                      <span class="date">${new Date(p.created_at).toLocaleDateString()}</span>
                  </div>
              </div>
              <div class="feed-card-actions">
                  <button class="play-pattern-btn primary-btn" data-id="${p.id}">Play</button>
                  <button class="add-practice-btn secondary-btn" data-id="${p.id}" data-title="${safeName}" style="padding: 8px 12px; font-size: 13px;">➕ Add to Plan</button>
                  ${deleteBtnHtml}
              </div>
          `;

    // Attach Event Listeners
    const playBtn = card.querySelector('.play-pattern-btn');
    playBtn.addEventListener('click', () => {
      loadPatternFromFeed(p.pattern_json, p.name);
      document.body.style.overflow = '';
      feedModal.classList.remove('open');
    });

    const pracBtn = card.querySelector('.add-practice-btn');
    pracBtn?.addEventListener('click', (e) => {
      addToPractice('pattern', p.id, p.name);
      pracBtn.textContent = '✅ Added';
      setTimeout(() => pracBtn.textContent = '➕ Add to Plan', 2000);
    });

    const likeBtn = card.querySelector('.like-btn');
    likeBtn.addEventListener('click', (e) => toggleLike(e, p.id, likeBtn));

    if (isOwner) {
      const delBtn = card.querySelector('.delete-pattern-btn');
      delBtn?.addEventListener('click', (e) => deleteSharedPattern(p.id, card));
    }

    feedGrid.appendChild(card);
  });
}


async function toggleLike(e, patternId, btn) {
  if (!currentUser) {
    alert('Please sign in to like patterns.');
    // Open auth modal via the correct button
    const accountBtn = document.getElementById('accountBtn') || document.getElementById('authBtn');
    if (accountBtn) accountBtn.click();
    return;
  }

  // Optimistic Update
  const countSpan = btn.querySelector('.likes-count');
  let currentCount = parseInt(countSpan.textContent) || 0;
  const isLiked = btn.classList.contains('liked');

  // Toggle UI immediately (Optimistic)
  btn.classList.toggle('liked');
  const newCount = isLiked ? Math.max(0, currentCount - 1) : currentCount + 1;
  countSpan.textContent = newCount;

  // Perform Request
  // First try to LIKE
  const { error: insertError } = await supabase
    .from('pattern_likes')
    .insert([{ user_id: currentUser.id, pattern_id: patternId }]);

  if (!insertError) {
    // Success: Liked (DB matched UI)
  } else {
    // Failed: Likely duplicate key -> ALREADY LIKED -> UNLIKE
    if (insertError.code === '23505') { // Unique violation
      const { error: deleteError } = await supabase
        .from('pattern_likes')
        .delete()
        .eq('user_id', currentUser.id)
        .eq('pattern_id', patternId);

      if (deleteError) {
        console.error('Unlike error:', deleteError);
        // Revert UI if unlike failed
        btn.classList.add('liked');
        countSpan.textContent = currentCount;
      }
    } else {
      console.error('Like error:', insertError);
      // Revert UI if like failed (and not a duplicate)
      btn.classList.remove('liked');
      countSpan.textContent = currentCount;
    }
  }
}
async function deleteSharedPattern(id, cardElement) {
  if (!confirm('Are you sure you want to unshare this pattern? It will be removed from the community feed.')) return;

  const { error } = await supabase
    .from('shared_patterns')
    .delete()
    .eq('id', id)
    .eq('user_id', currentUser.id); // Extra safety check

  if (error) {
    console.error('Error deleting pattern:', error);
    alert('Failed to delete pattern: ' + error.message);
    return;
  }

  // Remove from UI
  cardElement.remove();

  // Check if empty
  if (feedGrid.children.length === 0) {
    feedGrid.innerHTML = '<div class="empty-state">No patterns found in this category.</div>';
  }
}


