import { escapeHtml } from './utils.js';
import { loadPatternFromFeed } from './feed.js';
import { currentUser } from './state.js';
import { supabase } from './supabase-client.js';
import { serializePattern } from './pattern-crud.js';
import { alert, confirm, prompt } from './alert.js';

/**
 * Community Posts (Discussion)
 * Handles Posts, Comments, Likes, and Media Attachments
 */

let postsFeed;
let createPostContainer;

let postsSubscription = null;
let cachedPosts = [];
let postsLoaded = false;
let listenersInitialized = false;

// Initialize
export async function initCommunityPosts() {
  postsFeed = document.getElementById('postsFeed');
  createPostContainer = document.getElementById('createPostContainer');

  if (!listenersInitialized) {
    setupCommunityEventListeners();
    listenersInitialized = true;
  }

  if (!document.getElementById('newPostContent')) renderCreatePostArea();

  if (!postsLoaded) {
    fetchPosts();
    postsLoaded = true;
  }

  if (postsSubscription) return; // Already subscribed

  // Subscribe to Realtime
  postsSubscription = supabase
    .channel('public:community_posts')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'community_posts' }, payload => {
      // Handle Updates (Insert, Update, Delete)
      if (payload.eventType === 'INSERT') {
        fetchPosts(); // Simplest strategy: Refresh. optimize later if needed.
      } else if (payload.eventType === 'UPDATE') {
        fetchPosts();
      }
    })
    .subscribe();
}

function setupCommunityEventListeners() {
  // Global Event Delegation for Dynamic Content
  document.body.addEventListener('click', async (e) => {
    // 1. Media Upload Triggers
    if (e.target.matches('[data-action="upload-media"]')) {
      const type = e.target.dataset.type;
      triggerMediaUpload(type);
      return;
    }

    // 2. Attach Current Pattern
    if (e.target.matches('[data-action="attach-pattern"]')) {
      attachCurrentPattern();
      return;
    }

    // 3. Delete Post
    if (e.target.matches('[data-action="delete-post"]')) {
      const id = e.target.dataset.id;
      deletePost(id, e.target);
      return;
    }

    // 4. Like Post
    if (e.target.matches('[data-action="like-post"]')) {
      const id = e.target.dataset.id;
      togglePostLike(id, e.target);
      return;
    }

    // 5. Toggle Comments
    if (e.target.matches('[data-action="toggle-comments"]')) {
      const id = e.target.dataset.id;
      toggleComments(id);
      return;
    }

    // 6. Submit Comment
    if (e.target.matches('[data-action="submit-comment"]')) {
      const id = e.target.dataset.id;
      submitComment(id);
      return;
    }

    // 7. Clear Attachment
    if (e.target.matches('[data-action="clear-attachment"]')) {
      clearDraftAttachment();
      return;
    }
  });
}

function renderCreatePostArea() {
  if (!createPostContainer) return;

  const userInitial = currentUser ? currentUser.email.charAt(0).toUpperCase() : '?';
  const isLoggedIn = !!currentUser;

  createPostContainer.innerHTML = `
    <div class="create-post-card">
        <div class="cp-header">
            <div class="cp-avatar">${userInitial}</div>
            <textarea id="newPostContent" class="cp-input" placeholder="Start a discussion..." ${!isLoggedIn ? 'disabled' : ''}></textarea>
        </div>
        
        <!-- Attachments Preview -->
        <div id="postAttachments" class="cp-attachments"></div>

        <div class="cp-actions">
            <div class="cp-tools">
                <button class="cp-tool-btn" data-action="upload-media" data-type="image">📸 Photo</button>
                <button class="cp-tool-btn" data-action="upload-media" data-type="video">🎥 Video</button>
                <button class="cp-tool-btn" data-action="upload-media" data-type="audio">🎤 Audio</button>
                <button class="cp-tool-btn" data-action="attach-pattern">🎵 Pattern</button>
            </div>
            <button id="publishPostBtn" class="cp-publish-btn" disabled>Post</button>
        </div>
        ${!isLoggedIn ? '<div class="cp-login-hint">Sign in to join the discussion</div>' : ''}
    </div>
    
    <!-- Hidden File Input -->
    <input type="file" id="mediaInput" style="display:none">
  `;

  // Listeners
  const input = document.getElementById('newPostContent');
  const btn = document.getElementById('publishPostBtn');

  if (isLoggedIn) {
    if (input) {
      input.addEventListener('input', () => {
        btn.disabled = input.value.trim() === '' && !currentDraftAttachment;
      });
    }

    if (btn) {
      btn.addEventListener('click', submitPost);
    }
  }
}

// State for draft attachment
let currentDraftAttachment = null; // { type: 'image'|'video'|'audio'|'pattern', data: ... }

// Media Upload Logic
async function triggerMediaUpload(type) {
  if (!currentUser) {
    await alert('Please sign in.');
    return;
  }
  const fileInput = document.getElementById('mediaInput');

  // Set accept types
  if (type === 'image') fileInput.accept = 'image/*';
  if (type === 'video') fileInput.accept = 'video/*';
  if (type === 'audio') fileInput.accept = 'audio/*';

  fileInput.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      setDraftAttachment({
        type: type,
        file: file, // Keep raw file for upload
        previewUrl: ev.target.result
      });
    };
    reader.readAsDataURL(file);

    // Clear input
    fileInput.value = '';
  };

  fileInput.click();
}

async function attachCurrentPattern() {
  if (!currentUser) {
    await alert('Please sign in.');
    return;
  }

  const pattern = serializePattern();


  if (!pattern) {
    console.warn("serializePattern failed or returned null");
    return;
  }

  const name = document.querySelector('.pattern-name')?.textContent || 'My Pattern';

  setDraftAttachment({
    type: 'pattern',
    data: pattern,
    name: name
  });
}

function setDraftAttachment(att) {
  currentDraftAttachment = att;
  renderAttachmentsPreview();
  const btn = document.getElementById('publishPostBtn');
  if (btn) btn.disabled = false;
}

function renderAttachmentsPreview() {
  const container = document.getElementById('postAttachments');
  if (!container) return;

  container.innerHTML = '';
  if (!currentDraftAttachment) return;

  const att = currentDraftAttachment;
  const el = document.createElement('div');
  el.className = 'attachment-preview';

  let content = '';
  if (att.type === 'image') {
    content = `<img src="${att.previewUrl}" class="att-img-preview">`;
  } else if (att.type === 'video') {
    content = `<video src="${att.previewUrl}" controls class="att-video-preview"></video>`;
  } else if (att.type === 'audio') {
    content = `<audio src="${att.previewUrl}" controls class="att-audio-preview"></audio>`;
  } else if (att.type === 'pattern') {
    content = `<div class="att-pattern-card">🎵 ${att.name} (Attached)</div>`;
  }

  el.innerHTML = `
        ${content}
        <button class="remove-att-btn" data-action="clear-attachment">×</button>
    `;

  container.appendChild(el);
}

function clearDraftAttachment() {
  currentDraftAttachment = null;
  renderAttachmentsPreview();
  const input = document.getElementById('newPostContent');
  const btn = document.getElementById('publishPostBtn');
  if (input && btn) {
    btn.disabled = input.value.trim() === '';
  }
}

async function submitPost() {
  const input = document.getElementById('newPostContent');
  if (!input) return;

  const content = input.value.trim();
  if (!content && !currentDraftAttachment) return;

  const btn = document.getElementById('publishPostBtn');
  btn.disabled = true;
  btn.textContent = 'Posting...';

  try {
    let mediaUrl = null;
    let mediaType = null;
    let sharedPatternId = null;

    // Handle Uploads
    if (currentDraftAttachment) {
      const att = currentDraftAttachment;
      if (att.type === 'pattern') {
        // Create share entry
        const { data, error } = await supabase.from('shared_patterns').insert([{
          user_id: currentUser.id,
          name: att.name,
          pattern_json: att.data,
          description: content || 'Shared via Discussion'
        }]).select().single();

        if (error) throw error;
        sharedPatternId = data.id;
      } else {
        // File Upload
        const textType = att.type; // image, video, audio
        mediaType = textType;

        const fileExt = att.file.name.split('.').pop();
        const fileName = `${currentUser.id}/${Date.now()}.${fileExt}`;

        const { data, error } = await supabase.storage
          .from('post-media')
          .upload(fileName, att.file);

        if (error) {
          console.warn('Upload failed (Bucket missing?), ignoring media.', error);
          await alert('Media upload failed. Please contact admin to set up storage buckets.');
          mediaType = null;
        } else {
          const { data: publicData } = supabase.storage.from('post-media').getPublicUrl(fileName);
          mediaUrl = publicData.publicUrl;
        }
      }
    }

    const { error } = await supabase.from('community_posts').insert([{
      user_id: currentUser.id,
      content: content,
      media_url: mediaUrl,
      media_type: mediaType,
      shared_pattern_id: sharedPatternId
    }]);

    if (error) throw error;

    // Reset UI
    input.value = '';
    clearDraftAttachment();
    fetchPosts(); // Refresh

  } catch (err) {
    console.error(err);
    await alert('Failed to post: ' + err.message);
  } finally {
    if (btn) {
      btn.textContent = 'Post';
      btn.disabled = false;
    }
  }
}


async function fetchPosts() {
  if (!postsFeed) return;
  postsFeed.innerHTML = '<div class="loading-spinner">Loading posts...</div>';

  // Fetch Posts + Profiles + Shared Pattern Info
  const { data, error } = await supabase
    .from('community_posts')
    .select(`
            *,
            profiles:user_id (username),
            pattern:shared_pattern_id (name, id),
            post_likes(count)
        `)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    postsFeed.innerHTML = '<div class="error-msg">Error loading posts</div>';
    return;
  }

  // Fetch which posts the current user has already liked
  let likedPostIds = new Set();
  if (currentUser && data.length > 0) {
    const { data: likedData } = await supabase
      .from('post_likes')
      .select('post_id')
      .eq('user_id', currentUser.id)
      .in('post_id', data.map(p => p.id));
    if (likedData) likedData.forEach(l => likedPostIds.add(l.post_id));
  }

  cachedPosts = data;
  renderFeed(data, likedPostIds);
}

function renderFeed(posts, likedPostIds = new Set()) {
  if (!postsFeed) return;
  postsFeed.innerHTML = '';
  if (posts.length === 0) {
    postsFeed.innerHTML = '<div class="empty-state">No discussions yet. Be the first!</div>';
    return;
  }

  posts.forEach(post => {
    postsFeed.appendChild(createPostCard(post, likedPostIds));
  });
}

function createPostCard(post, likedPostIds = new Set()) {
  const card = document.createElement('div');
  card.className = 'post-card';
  card.dataset.id = post.id;

  const author = post.profiles?.username || 'Unknown';
  const time = new Date(post.created_at).toLocaleString();
  const isLiked = likedPostIds.has(post.id);

  // Media Rendering
  let mediaHtml = '';
  if (post.media_url) {
    if (post.media_type === 'image') mediaHtml = `<img src="${post.media_url}" class="post-media-img" loading="lazy">`;
    else if (post.media_type === 'video') mediaHtml = `<video src="${post.media_url}" controls class="post-media-video"></video>`;
    else if (post.media_type === 'audio') mediaHtml = `<audio src="${post.media_url}" controls class="post-media-audio"></audio>`;
  }

  // Pattern Rendering
  let patternHtml = '';
  if (post.shared_pattern_id && post.pattern) {
    patternHtml = `
            <div class="post-pattern-card">
                <div class="pp-icon">🎵</div>
                <div class="pp-info">
                    <div class="pp-name">${post.pattern.name}</div>
                    <div class="pp-sub">Attached Pattern</div>
                </div>
                <!-- Note: Using onclick here for simple pattern loading for now, or could use delegation too -->
                <button class="pp-play-btn">▶ Load</button>
            </div>
        `;
  }

  const isOwner = currentUser && currentUser.id === post.user_id;
  const deleteBtnHtml = isOwner
    ? `<button class="pf-btn delete-post-btn" data-action="delete-post" data-id="${post.id}" title="Delete Post">🗑️ Delete</button>`
    : '';

  card.innerHTML = `
        <div class="post-header">
            <div class="post-avatar">${author.charAt(0).toUpperCase()}</div>
            <div class="post-meta">
                <span class="post-author">${author}</span>
                <span class="post-time">${time}</span>
            </div>
        </div>
        
        <div class="post-body">
            <p class="post-text">${escapeHtml(post.content)}</p>
            ${mediaHtml}
            ${patternHtml}
        </div>
        
        <div class="post-footer">
            <div class="pf-stats">
               <span class="post-likes-count">${post.post_likes?.[0]?.count ?? post.likes_count ?? 0} Likes</span>
            </div>
            <div class="pf-actions">
                <button class="pf-btn like-btn ${isLiked ? 'liked' : ''}" data-action="like-post" data-id="${post.id}">👍 Like</button>
                <button class="pf-btn comment-btn" data-action="toggle-comments" data-id="${post.id}">💬 Comment</button>
                ${deleteBtnHtml}
            </div>
        </div>
        
        <!-- Comments Section -->
        <div id="comments-${post.id}" class="post-comments-section" style="display:none;">
            <div class="comments-list" id="clist-${post.id}"></div>
            <div class="comment-input-area">
                <textarea class="comment-input" placeholder="Write a comment..."></textarea>
                <div class="comment-actions">
                    <button class="c-send-btn" data-action="submit-comment" data-id="${post.id}">➤</button>
                </div>
            </div>
        </div>
    `;

  if (post.shared_pattern_id) {
    const pCard = card.querySelector('.post-pattern-card');
    if (pCard) {
      // Keep this as regular listener or delegation? Regular is fine for internal card logic
      pCard.onclick = () => fetchAndLoadPattern(post.shared_pattern_id);
    }
  }

  return card;
}

async function deletePost(postId, btn) {
  const ok = await confirm('Are you sure you want to delete this post?');
  if (!ok) return;

  const { error } = await supabase
    .from('community_posts')
    .delete()
    .eq('id', postId)
    .eq('user_id', currentUser.id);

  if (error) {
    console.error('Delete error:', error);
    await alert('Failed to delete post: ' + error.message);
    return;
  }

  // Remove from UI
  // Find parent .post-card
  let el = btn.closest('.post-card');
  if (el) el.remove();

  if (postsFeed.children.length === 0) {
    postsFeed.innerHTML = '<div class="empty-state">No discussions yet. Be the first!</div>';
  }
}

async function togglePostLike(postId, btn) {
  if (!currentUser) {
    await alert('Sign in to like posts');
    return;
  }

  const countSpan = btn.closest('.post-footer')?.querySelector('.post-likes-count');
  const currentCount = parseInt(countSpan?.textContent) || 0;
  const isLiked = btn.classList.contains('liked');

  // Optimistic UI
  btn.classList.toggle('liked');
  if (countSpan) countSpan.textContent = `${isLiked ? Math.max(0, currentCount - 1) : currentCount + 1} Likes`;

  if (isLiked) {
    const { error } = await supabase
      .from('post_likes')
      .delete()
      .eq('user_id', currentUser.id)
      .eq('post_id', postId);
    if (error) {
      btn.classList.add('liked');
      if (countSpan) countSpan.textContent = `${currentCount} Likes`;
    }
  } else {
    const { error } = await supabase
      .from('post_likes')
      .insert([{ user_id: currentUser.id, post_id: postId }]);
    if (error) {
      btn.classList.remove('liked');
      if (countSpan) countSpan.textContent = `${currentCount} Likes`;
    }
  }
}

async function toggleComments(postId) {
  const sec = document.getElementById(`comments-${postId}`);
  const isHidden = sec.style.display === 'none';
  sec.style.display = isHidden ? 'block' : 'none';

  if (isHidden) {
    // Load Comments
    loadComments(postId);
  }
}

async function loadComments(postId) {
  const list = document.getElementById(`clist-${postId}`);
  if (!list) return;

  list.innerHTML = '<div class="spinner-small"></div>';

  const { data } = await supabase
    .from('post_comments')
    .select('*, profiles:user_id(username)')
    .eq('post_id', postId)
    .order('created_at', { ascending: true });

  if (data) {
    list.innerHTML = data.map(c => `
            <div class="comment-row">
                <div class="c-avatar">${(c.profiles?.username || '?').charAt(0)}</div>
                <div class="c-bubble">
                    <div class="c-author">${c.profiles?.username}</div>
                    <div class="c-text">${escapeHtml(c.content)}</div>
                </div>
            </div>
        `).join('');
  }
}

async function submitComment(postId) {
  if (!currentUser) {
    await alert("Please sign in.");
    return;
  }

  const sec = document.getElementById(`comments-${postId}`);
  const input = sec.querySelector('.comment-input');
  const content = input.value.trim();
  if (!content) return;

  const { error } = await supabase.from('post_comments').insert([{
    post_id: postId,
    user_id: currentUser.id,
    content: content
  }]);

  if (!error) {
    input.value = '';
    loadComments(postId); // Refresh
  }
}

async function fetchAndLoadPattern(pid) {
  const { data } = await supabase.from('shared_patterns').select('*').eq('id', pid).single();
  if (data) {
    loadPatternFromFeed(data.pattern_json, data.name);
  }
}
