import { escapeHtml } from './utils.js';
import { loadPatternFromFeed } from './feed.js';
import { currentUser } from './state.js';
import { supabase } from './supabase-client.js';
import { serializePattern } from './pattern-crud.js';
import { alert, confirm, prompt } from './alert.js';
import { showToast } from './toast.js';
import { uploadFileWithProgress } from './storage-upload.js';
import { playSuccessChime, warmAudioContext } from './ui-sound.js';

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
        // Updates here are almost always the likes_count trigger firing after a
        // like/unlike. Patch just that post's count in place instead of
        // refetching + re-rendering the whole feed (was causing a jitter/flicker
        // on every like, including other users' likes).
        patchPostLikeCount(payload.new);
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

    // 8. Retry a failed background post
    if (e.target.matches('[data-action="retry-pending"]')) {
      const tempId = e.target.dataset.tempId;
      const pending = pendingUploads.get(tempId);
      if (pending) processPostUpload(tempId, pending.content, pending.attachment);
      return;
    }

    // 9. Discard a failed background post
    if (e.target.matches('[data-action="discard-pending"]')) {
      const tempId = e.target.dataset.tempId;
      pendingUploads.delete(tempId);
      document.getElementById(tempId)?.remove();
      maybeShowEmptyState();
      return;
    }

    // 10. Toggle a reply-to-comment input
    if (e.target.matches('[data-action="toggle-reply"]')) {
      const commentId = e.target.dataset.commentId;
      const area = document.getElementById(`reply-input-${commentId}`);
      if (area) {
        const showing = area.style.display !== 'none';
        area.style.display = showing ? 'none' : 'flex';
        if (!showing) area.querySelector('textarea')?.focus();
      }
      return;
    }

    // 11. Submit a reply to a comment
    if (e.target.matches('[data-action="submit-reply"]')) {
      const postId = e.target.dataset.postId;
      const parentId = e.target.dataset.parentId;
      submitComment(postId, parentId);
      return;
    }

    // 12. Start editing a comment
    if (e.target.matches('[data-action="toggle-edit-comment"]')) {
      const commentId = e.target.dataset.commentId;
      const bubble = document.getElementById(`bubble-${commentId}`);
      const editArea = document.getElementById(`edit-input-${commentId}`);
      if (bubble && editArea) {
        bubble.style.display = 'none';
        editArea.style.display = 'flex';
        editArea.querySelector('textarea')?.focus();
      }
      return;
    }

    // 13. Cancel editing a comment
    if (e.target.matches('[data-action="cancel-edit-comment"]')) {
      const commentId = e.target.dataset.commentId;
      const bubble = document.getElementById(`bubble-${commentId}`);
      const editArea = document.getElementById(`edit-input-${commentId}`);
      if (bubble && editArea) {
        editArea.style.display = 'none';
        bubble.style.display = 'block';
      }
      return;
    }

    // 14. Save a comment edit
    if (e.target.matches('[data-action="save-edit-comment"]')) {
      const commentId = e.target.dataset.commentId;
      const postId = e.target.dataset.postId;
      saveCommentEdit(postId, commentId);
      return;
    }

    // 15. Delete a comment
    if (e.target.matches('[data-action="delete-comment"]')) {
      const commentId = e.target.dataset.commentId;
      const postId = e.target.dataset.postId;
      deleteComment(postId, commentId);
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

// Posts currently uploading in the background: tempId -> { content, attachment }
const pendingUploads = new Map();

function submitPost() {
  const input = document.getElementById('newPostContent');
  if (!input) return;

  const content = input.value.trim();
  const attachment = currentDraftAttachment;
  if (!content && !attachment) return;

  // Reset the composer immediately so the user is free to keep using the
  // app (post again, browse, navigate) while this one uploads in the
  // background — large videos in particular can take a while.
  input.value = '';
  clearDraftAttachment();

  // Unlock the AudioContext now, inside this click handler, so the
  // completion chime can actually play later once the upload finishes
  // (Safari in particular won't allow audio to start outside a gesture).
  warmAudioContext();

  const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  pendingUploads.set(tempId, { content, attachment });

  if (postsFeed) {
    postsFeed.querySelector('.empty-state')?.remove();
    postsFeed.prepend(createPendingPostCard(tempId, content, attachment));
  }

  processPostUpload(tempId, content, attachment);
}

async function processPostUpload(tempId, content, attachment) {
  const card = document.getElementById(tempId);
  if (card) {
    card.classList.remove('post-pending-error');
    const statusRow = card.querySelector('.pending-status-row, .pending-error-row');
    if (statusRow) statusRow.outerHTML = pendingStatusRowHtml(attachment);
  }

  try {
    let mediaUrl = null;
    let mediaType = null;
    let sharedPatternId = null;
    let mediaDegraded = false;

    if (attachment) {
      if (attachment.type === 'pattern') {
        const { data, error } = await supabase.from('shared_patterns').insert([{
          user_id: currentUser.id,
          name: attachment.name,
          pattern_json: attachment.data,
          description: content || 'Shared via Discussion'
        }]).select().single();

        if (error) throw error;
        sharedPatternId = data.id;
      } else {
        // File Upload (image / video / audio)
        mediaType = attachment.type;

        const fileExt = attachment.file.name.split('.').pop();
        const fileName = `${currentUser.id}/${Date.now()}.${fileExt}`;

        try {
          await uploadFileWithProgress('post-media', fileName, attachment.file, (fraction) => {
            updatePendingProgress(tempId, fraction);
          });
          const { data: publicData } = supabase.storage.from('post-media').getPublicUrl(fileName);
          mediaUrl = publicData.publicUrl;
        } catch (uploadErr) {
          console.warn('Media upload failed.', uploadErr);
          mediaType = null;
          mediaDegraded = true;
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

    pendingUploads.delete(tempId);
    document.getElementById(tempId)?.remove();
    fetchPosts(); // Refresh with the real post now that it exists

    if (mediaDegraded) {
      showToast('Post published, but the media failed to upload.', { type: 'error' });
    } else {
      showToast('Your post is live!', { type: 'success' });
      playSuccessChime();
    }

  } catch (err) {
    console.error(err);
    pendingUploads.set(tempId, { content, attachment }); // keep for retry
    showFailedPendingCard(tempId, err.message);
    showToast('A post failed to upload.', { type: 'error' });
  }
}

function describeUploadStatus(attachment) {
  if (!attachment) return 'Posting…';
  if (attachment.type === 'pattern') return 'Posting…';
  return `Uploading ${attachment.type}… Please leave this tab open...`;
}

// A visible progress bar only makes sense for real file uploads (image/video/audio) —
// pattern shares and text-only posts are near-instant single inserts.
function hasProgressBar(attachment) {
  return !!attachment && attachment.type !== 'pattern';
}

function pendingStatusRowHtml(attachment) {
  const bar = hasProgressBar(attachment)
    ? `<div class="pending-progress-track"><div class="pending-progress-fill" style="width:0%"></div></div><span class="pending-progress-pct">0%</span>`
    : '';
  return `<div class="pending-status-row"><span class="pending-spinner"></span> ${describeUploadStatus(attachment)}${bar}</div>`;
}

function updatePendingProgress(tempId, fraction) {
  const card = document.getElementById(tempId);
  if (!card) return;
  const pct = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  const fill = card.querySelector('.pending-progress-fill');
  const label = card.querySelector('.pending-progress-pct');
  const overlayPct = card.querySelector('.pending-overlay-pct');
  if (fill) fill.style.width = `${pct}%`;
  if (label) label.textContent = `${pct}%`;
  if (overlayPct) overlayPct.textContent = `${pct}%`;
}

function showFailedPendingCard(tempId, message) {
  const card = document.getElementById(tempId);
  if (!card) return;
  const statusRow = card.querySelector('.pending-status-row, .pending-error-row');
  if (statusRow) {
    statusRow.outerHTML = `
      <div class="pending-error-row">
        <span>Failed to post${message ? ': ' + escapeHtml(message) : ''}</span>
        <button class="pending-retry-btn" data-action="retry-pending" data-temp-id="${tempId}">Retry</button>
        <button class="pending-discard-btn" data-action="discard-pending" data-temp-id="${tempId}">Discard</button>
      </div>`;
  }
}

function maybeShowEmptyState() {
  if (postsFeed && postsFeed.children.length === 0) {
    postsFeed.innerHTML = '<div class="empty-state">No discussions yet. Be the first!</div>';
  }
}

function createPendingPostCard(tempId, content, attachment) {
  const card = document.createElement('div');
  card.className = 'post-card post-pending';
  card.id = tempId;

  const userInitial = currentUser ? currentUser.email.charAt(0).toUpperCase() : '?';

  let mediaHtml = '';
  if (attachment && attachment.previewUrl) {
    if (attachment.type === 'image') {
      mediaHtml = `<div class="pending-media-wrap"><img src="${attachment.previewUrl}" class="post-media-img"><div class="pending-overlay"><span class="pending-spinner"></span> Uploading… <span class="pending-overlay-pct"></span></div></div>`;
    } else if (attachment.type === 'video') {
      mediaHtml = `<div class="pending-media-wrap"><video src="${attachment.previewUrl}" class="post-media-video" muted></video><div class="pending-overlay"><span class="pending-spinner"></span> Uploading… <span class="pending-overlay-pct"></span></div></div>`;
    } else if (attachment.type === 'audio') {
      mediaHtml = `<audio src="${attachment.previewUrl}" controls class="post-media-audio"></audio>`;
    } else if (attachment.type === 'pattern') {
      mediaHtml = `<div class="post-pattern-card"><div class="pp-icon">🎵</div><div class="pp-info"><div class="pp-name">${escapeHtml(attachment.name)}</div><div class="pp-sub">Attached Pattern</div></div></div>`;
    }
  }

  card.innerHTML = `
        <div class="post-header">
            <div class="post-avatar">${userInitial}</div>
            <div class="post-meta">
                <span class="post-author">${currentUser?.email || 'You'}</span>
                <span class="post-time">Just now</span>
            </div>
        </div>
        <div class="post-body">
            <p class="post-text">${escapeHtml(content)}</p>
            ${mediaHtml}
        </div>
        ${pendingStatusRowHtml(attachment)}
    `;

  return card;
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
            post_likes(count),
            post_comments(count)
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
               <span class="post-comments-count" data-action="toggle-comments" data-id="${post.id}">${post.post_comments?.[0]?.count ?? 0} Comments</span>
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

function patchPostLikeCount(updatedPost) {
  if (!updatedPost) return;
  const card = document.querySelector(`.post-card[data-id="${updatedPost.id}"]`);
  const countSpan = card?.querySelector('.post-likes-count');
  if (countSpan && typeof updatedPost.likes_count === 'number') {
    countSpan.textContent = `${updatedPost.likes_count} Likes`;
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

/**
 * Scrolls to a specific post (e.g. from a "someone commented on your post"
 * notification) and opens its comments. The feed only loads recent posts,
 * and fetchPosts() may still be in flight, so this retries briefly before
 * giving up.
 */
export function focusPost(postId, attemptsLeft = 8) {
  const card = postsFeed?.querySelector(`.post-card[data-id="${postId}"]`);
  if (card) {
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.add('post-highlight');
    setTimeout(() => card.classList.remove('post-highlight'), 2000);

    const commentsSec = document.getElementById(`comments-${postId}`);
    if (commentsSec && commentsSec.style.display === 'none') {
      toggleComments(postId);
    }
    return;
  }

  if (attemptsLeft > 0) {
    setTimeout(() => focusPost(postId, attemptsLeft - 1), 400);
  } else {
    showToast("Couldn't find that post — it may be older than what's shown.", { type: 'info' });
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
    const tree = buildCommentTree(data);
    list.innerHTML = tree.length
      ? tree.map(c => renderCommentNode(c, postId)).join('')
      : '<div class="c-empty">No comments yet.</div>';
  }
}

// Turns a flat, chronologically-ordered comment list into a tree of
// { ...comment, children: [...] } nodes, nesting replies under their parent.
function buildCommentTree(flat) {
  const byId = new Map();
  flat.forEach(c => byId.set(c.id, { ...c, children: [] }));

  const roots = [];
  flat.forEach(c => {
    const node = byId.get(c.id);
    const parent = c.parent_comment_id && byId.get(c.parent_comment_id);
    if (parent) parent.children.push(node);
    else roots.push(node);
  });
  return roots;
}

function renderCommentNode(c, postId) {
  const childrenHtml = c.children.map(ch => renderCommentNode(ch, postId)).join('');

  if (c.is_deleted) {
    // Keep the row (and its replies) in place — just show a placeholder,
    // with no reply/edit/delete actions available on it any more.
    return `
        <div class="comment-row" data-comment-id="${c.id}">
            <div class="c-avatar">${(c.profiles?.username || '?').charAt(0)}</div>
            <div class="c-body">
                <div class="c-bubble c-bubble-deleted">
                    <div class="c-text c-text-deleted">Comment deleted.</div>
                </div>
                ${childrenHtml ? `<div class="c-replies">${childrenHtml}</div>` : ''}
            </div>
        </div>
    `;
  }

  const isOwner = currentUser && currentUser.id === c.user_id;
  const wasEdited = c.updated_at && c.created_at && c.updated_at !== c.created_at;

  const ownerActionsHtml = isOwner ? `
                    <button class="c-reply-btn" data-action="toggle-edit-comment" data-comment-id="${c.id}">Edit</button>
                    <button class="c-reply-btn c-delete-btn" data-action="delete-comment" data-comment-id="${c.id}" data-post-id="${postId}">Delete</button>` : '';

  return `
        <div class="comment-row" data-comment-id="${c.id}">
            <div class="c-avatar">${(c.profiles?.username || '?').charAt(0)}</div>
            <div class="c-body">
                <div class="c-bubble" id="bubble-${c.id}">
                    <div class="c-author">${escapeHtml(c.profiles?.username || 'Unknown')}</div>
                    <div class="c-text">${escapeHtml(c.content)}${wasEdited ? ' <span class="c-edited-tag">Edited</span>' : ''}</div>
                </div>
                <div class="c-edit-area" id="edit-input-${c.id}" style="display:none;">
                    <textarea class="comment-input c-edit-textarea">${escapeHtml(c.content)}</textarea>
                    <div class="comment-actions">
                        <button class="c-send-btn" data-action="save-edit-comment" data-comment-id="${c.id}" data-post-id="${postId}">Save</button>
                        <button class="c-cancel-btn" data-action="cancel-edit-comment" data-comment-id="${c.id}">Cancel</button>
                    </div>
                </div>
                <div class="c-actions">
                    <button class="c-reply-btn" data-action="toggle-reply" data-comment-id="${c.id}">Reply</button>${ownerActionsHtml}
                </div>
                <div class="c-reply-input-area" id="reply-input-${c.id}" style="display:none;">
                    <textarea class="comment-input c-reply-textarea" placeholder="Write a reply..."></textarea>
                    <div class="comment-actions">
                        <button class="c-send-btn" data-action="submit-reply" data-post-id="${postId}" data-parent-id="${c.id}">➤</button>
                    </div>
                </div>
                ${childrenHtml ? `<div class="c-replies">${childrenHtml}</div>` : ''}
            </div>
        </div>
    `;
}

async function submitComment(postId, parentCommentId = null) {
  if (!currentUser) {
    await alert("Please sign in.");
    return;
  }

  const input = parentCommentId
    ? document.querySelector(`#reply-input-${parentCommentId} .c-reply-textarea`)
    : document.getElementById(`comments-${postId}`)?.querySelector('.comment-input');
  if (!input) return;

  const content = input.value.trim();
  if (!content) return;

  const { error } = await supabase.from('post_comments').insert([{
    post_id: postId,
    user_id: currentUser.id,
    parent_comment_id: parentCommentId,
    content: content
  }]);

  if (error) {
    console.error('Failed to post comment:', error);
    await alert('Failed to post comment: ' + error.message);
    return;
  }

  input.value = '';
  loadComments(postId); // Refresh
  refreshCommentCount(postId);
}

async function saveCommentEdit(postId, commentId) {
  const editArea = document.getElementById(`edit-input-${commentId}`);
  const textarea = editArea?.querySelector('.c-edit-textarea');
  if (!textarea) return;

  const content = textarea.value.trim();
  if (!content) return;

  const { error } = await supabase
    .from('post_comments')
    .update({ content })
    .eq('id', commentId)
    .eq('user_id', currentUser.id);

  if (error) {
    console.error('Failed to edit comment:', error);
    await alert('Failed to save your edit: ' + error.message);
    return;
  }

  loadComments(postId);
}

async function deleteComment(postId, commentId) {
  const ok = await confirm("Delete this comment? It will be replaced with \"Comment deleted.\" (any replies to it are kept).");
  if (!ok) return;

  // Soft delete: replies reference this comment via parent_comment_id, so a
  // hard delete would cascade-remove them too. Flagging it instead keeps
  // the thread intact.
  const { error } = await supabase
    .from('post_comments')
    .update({ is_deleted: true })
    .eq('id', commentId)
    .eq('user_id', currentUser.id);

  if (error) {
    console.error('Failed to delete comment:', error);
    await alert('Failed to delete comment: ' + error.message);
    return;
  }

  loadComments(postId);
}

async function refreshCommentCount(postId) {
  const { count } = await supabase
    .from('post_comments')
    .select('id', { count: 'exact', head: true })
    .eq('post_id', postId);

  const card = document.querySelector(`.post-card[data-id="${postId}"]`);
  const countSpan = card?.querySelector('.post-comments-count');
  if (countSpan && typeof count === 'number') countSpan.textContent = `${count} Comments`;
}

async function fetchAndLoadPattern(pid) {
  const { data } = await supabase.from('shared_patterns').select('*').eq('id', pid).single();
  if (data) {
    loadPatternFromFeed(data.pattern_json, data.name);
  }
}
