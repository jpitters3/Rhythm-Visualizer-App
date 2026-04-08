import { escapeHtml } from './utils.js';
import { currentUser } from './state.js';
import { supabase } from './supabase-client.js';
import { addToPractice } from './practice.js';
import { applyPattern } from './pattern-crud.js';
import { updateCurrentPhraseName } from './controls.js';
import { alert, confirm } from './alert.js';
import { navigate } from './router.js';

// Community Feed Logic

export async function loadPatternFromFeed(json, name) {
  if (await confirm(`Load pattern "${name}"? Unsaved changes will be lost.`)) {
    await applyPattern(json);
    document.title = `Panafide — ${name}`;
    updateCurrentPhraseName(name);
    navigate('freeplay');
  }
}

let feedGrid;
let feedFilterTabs;
let navCompositionsBtn;
let navDiscussionBtn;
let currentFeedFilter = 'newest';
let compositionsView;
let discussionView;
let communityInitialized = false;

export function initFeed() {
  feedGrid = document.getElementById('feedGrid');
  feedFilterTabs = document.querySelectorAll('.feed-filter-tab');
  navCompositionsBtn = document.getElementById('navCompositionsBtn');
  navDiscussionBtn = document.getElementById('navDiscussionBtn');
  compositionsView = document.getElementById('compositionsView');
  discussionView = document.getElementById('discussionView');

  // Any element with data-action="open-community" navigates to the community route
  document.querySelectorAll('[data-action="open-community"]').forEach(btn => {
    if (!btn.dataset.listenerAttached) {
      btn.addEventListener('click', () => navigate('community'));
      btn.dataset.listenerAttached = 'true';
    }
  });

  navCompositionsBtn?.addEventListener('click', () => switchMainTab('compositions'));
  navDiscussionBtn?.addEventListener('click', () => switchMainTab('discussion'));

  feedFilterTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      feedFilterTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentFeedFilter = tab.dataset.filter;
      fetchFeed(currentFeedFilter);
    });
  });

  // Initialize on first visit to community route
  window.addEventListener('routeChanged', ({ detail }) => {
    if (detail.route === 'community' && !communityInitialized) {
      communityInitialized = true;
      switchMainTab('discussion');
    }
  });
}

let compositionsLoaded = false;

function switchMainTab(tabName) {
  if (tabName === 'discussion') {
    navDiscussionBtn?.classList.add('active');
    navCompositionsBtn?.classList.remove('active');
    if (discussionView) discussionView.style.display = 'block';
    if (compositionsView) compositionsView.style.display = 'none';

    import('./community-posts.js').then(({ initCommunityPosts }) => {
      initCommunityPosts();
    });
  } else {
    navCompositionsBtn?.classList.add('active');
    navDiscussionBtn?.classList.remove('active');
    if (compositionsView) compositionsView.style.display = 'block';
    if (discussionView) discussionView.style.display = 'none';

    if (!compositionsLoaded) {
      fetchFeed(currentFeedFilter);
      compositionsLoaded = true;
    }
  }
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

  if (filter === 'newest') {
    query = query.eq('is_public', true).order('created_at', { ascending: false });
  } else if (filter === 'top') {
    query = query.eq('is_public', true).order('likes_count', { ascending: false });
  } else if (filter === 'mine') {
    if (!currentUser) {
      feedGrid.innerHTML = '<div class="empty-state">Sign in to see your shared patterns.</div>';
      return;
    }
    query = query.eq('user_id', currentUser.id).order('created_at', { ascending: false });
  }

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

    const playBtn = card.querySelector('.play-pattern-btn');
    playBtn.addEventListener('click', () => {
      loadPatternFromFeed(p.pattern_json, p.name);
    });

    const pracBtn = card.querySelector('.add-practice-btn');
    pracBtn?.addEventListener('click', () => {
      addToPractice('pattern', p.id, p.name);
      pracBtn.textContent = '✅ Added';
      setTimeout(() => pracBtn.textContent = '➕ Add to Plan', 2000);
    });

    const likeBtn = card.querySelector('.like-btn');
    likeBtn.addEventListener('click', (e) => toggleLike(e, p.id, likeBtn));

    if (isOwner) {
      const delBtn = card.querySelector('.delete-pattern-btn');
      delBtn?.addEventListener('click', () => deleteSharedPattern(p.id, card));
    }

    feedGrid.appendChild(card);
  });
}

async function toggleLike(e, patternId, btn) {
  if (!currentUser) {
    await alert('Please sign in to like patterns.');
    const accountBtn = document.getElementById('accountBtn') || document.getElementById('authBtn');
    if (accountBtn) accountBtn.click();
    return;
  }

  const countSpan = btn.querySelector('.likes-count');
  let currentCount = parseInt(countSpan.textContent) || 0;
  const isLiked = btn.classList.contains('liked');

  btn.classList.toggle('liked');
  const newCount = isLiked ? Math.max(0, currentCount - 1) : currentCount + 1;
  countSpan.textContent = newCount;

  const { error: insertError } = await supabase
    .from('pattern_likes')
    .insert([{ user_id: currentUser.id, pattern_id: patternId }]);

  if (!insertError) {
    // Success
  } else {
    if (insertError.code === '23505') {
      const { error: deleteError } = await supabase
        .from('pattern_likes')
        .delete()
        .eq('user_id', currentUser.id)
        .eq('pattern_id', patternId);

      if (deleteError) {
        console.error('Unlike error:', deleteError);
        btn.classList.add('liked');
        countSpan.textContent = currentCount;
      }
    } else {
      console.error('Like error:', insertError);
      btn.classList.remove('liked');
      countSpan.textContent = currentCount;
    }
  }
}

async function deleteSharedPattern(id, cardElement) {
  if (!await confirm('Are you sure you want to unshare this pattern? It will be removed from the community feed.')) return;

  const { error } = await supabase
    .from('shared_patterns')
    .delete()
    .eq('id', id)
    .eq('user_id', currentUser.id);

  if (error) {
    console.error('Error deleting pattern:', error);
    await alert('Failed to delete pattern: ' + error.message);
    return;
  }

  cardElement.remove();

  if (feedGrid.children.length === 0) {
    feedGrid.innerHTML = '<div class="empty-state">No patterns found in this category.</div>';
  }
}
