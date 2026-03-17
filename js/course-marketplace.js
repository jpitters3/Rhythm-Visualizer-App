import { alert, confirm } from './alert.js';
import { supabase } from './supabase-client.js';
import { Bus, BUS_EVENT } from './bus.js';
import { currentUser, isAdminUser } from './state.js';
import { fetchCourses, setActiveCourse, openSidebar } from './courses.js';

let marketplaceModal = null;
let closeMarketBtn = null;
let marketGrid = null;

export async function openMarketplace() {
  if (!marketplaceModal) return;

  marketplaceModal.classList.add('open');
  marketplaceModal.setAttribute('aria-hidden', 'false');

  marketGrid.innerHTML = '<div class="loading-spinner">Loading courses...</div>';

  try {
    // 1. Fetch ALL courses
    const { data: allCourses, error: cErr } = await supabase
      .from('courses')
      .select('id, title, description, price, is_paid, thumbnail_url, owner_id, is_published')
      .order('created_at', { ascending: false });

    if (cErr) throw cErr;

    // 2. Fetch User's Owned Courses (with archive status)
    let ownedIds = new Set();
    let archivedIds = new Set();
    if (currentUser) {
      const { data: result, error: uErr } = await supabase
        .from('user_courses')
        .select('course_id, is_archived')
        .eq('user_id', currentUser.id);

      if (!uErr && result) {
        result.forEach(r => {
          ownedIds.add(r.course_id);
          if (r.is_archived) archivedIds.add(r.course_id);
        });
      }

      // Also owner owns their own courses
      allCourses.forEach(c => {
        if (c.owner_id === currentUser.id) ownedIds.add(c.id);
      });
    }

    renderMarketplace(allCourses || [], ownedIds, archivedIds);

  } catch (err) {
    console.error("Error loading marketplace:", err);
    marketGrid.innerHTML = '<div style="color:red">Failed to load courses.</div>';
  }
}

function renderMarketplace(courses, ownedIds, archivedIds = new Set()) {
  marketGrid.innerHTML = '';

  const isAdmin = typeof isAdminUser === 'function' ? isAdminUser(currentUser) : false;

  // Filter: If NOT admin, show only published
  const visibleCourses = courses.filter(c => {
    if (isAdmin) return true;
    return c.is_published === true;
  });

  if (visibleCourses.length === 0) {
    marketGrid.innerHTML = '<p>No courses available right now.</p>';
    return;
  }

  visibleCourses.forEach(course => {
    const isOwned = ownedIds.has(course.id);
    const isArchived = archivedIds.has(course.id);
    const isPaid = course.is_paid;
    const isPublished = course.is_published;

    // Badge
    let badgeClass = 'free';
    let badgeText = 'FREE';
    if (isPaid) { badgeClass = 'paid'; badgeText = `$${course.price}`; }
    if (isAdmin && !isPublished) { badgeClass = 'paid'; badgeText = 'DRAFT'; }
    else if (isOwned && isPublished) { badgeClass = 'free'; badgeText = isArchived ? 'ARCHIVED' : 'OWNED'; }

    // Button
    let btnClass = 'market-btn get';
    let btnText = 'Get Course';
    let btnAction = 'unlock-course';
    let btnDisabled = '';

    if (isPaid && !isOwned) {
      btnClass = 'market-btn buy';
      btnText = 'Buy Course';
    }

    if (isOwned) {
      if (isArchived) {
        btnClass = 'market-btn get';
        btnText = '✅ Activate';
        btnAction = 'activate-course';
      } else {
        btnClass = 'market-btn';
        btnText = '📦 Archive';
        btnAction = 'archive-course';
      }
    }

    const card = document.createElement('div');
    card.className = `market-card ${isPaid ? 'premium' : ''}`;
    if (!isPublished) card.style.opacity = '0.85';

    const thumbStyle = course.thumbnail_url
      ? `background-image: url('${course.thumbnail_url}')`
      : `background: linear-gradient(135deg, #1e3c72, #2a5298)`;

    let adminActions = '';
    if (isAdmin) {
      const publishLabel = isPublished ? 'Unpublish' : 'Publish';
      const publishColor = isPublished ? '#f39c12' : '#27ae60';

      adminActions = `
            <div style="display:flex; gap:8px; margin-top:8px;">
                <button class="market-btn" 
                    data-action="toggle-publish" data-id="${course.id}" data-status="${isPublished}"
                    style="background-color: ${publishColor}; border: none; flex:1;">
                    ${publishLabel}
                </button>
                <button class="market-btn" 
                    data-action="delete-course" data-id="${course.id}"
                    style="background-color: #e74c3c; border: none; flex:1;">
                    Delete
                </button>
            </div>
        `;
    }

    card.innerHTML = `
      <div class="card-thumb" style="${thumbStyle}">
        <div class="price-badge ${badgeClass}">${badgeText}</div>
      </div>
      <div class="card-content">
        <h3 class="card-title">${course.title} ${(!isPublished && isAdmin) ? '(Draft)' : ''}</h3>
        <div class="card-desc">${course.description || 'No description provided.'}</div>
        <button class="${btnClass}"
          ${btnDisabled}
          data-action="${btnAction}" data-id="${course.id}" data-paid="${isPaid}">
          ${btnText}
        </button>
        ${adminActions}
      </div>
    `;

    marketGrid.appendChild(card);
  });
}


export async function togglePublish(courseId, currentStatus) {
  const newStatus = !currentStatus;
  const action = newStatus ? "PUBLISH" : "UNPUBLISH";

  if (!await confirm(`ADMIN: Are you sure you want to ${action} this course?`)) return;

  try {
    const { error: cErr } = await supabase
      .from('courses')
      .update({ is_published: newStatus })
      .eq('id', courseId);

    if (cErr) throw cErr;

    if (newStatus === true) {
      const { error: sErr } = await supabase
        .from('sections')
        .update({ is_published: true })
        .eq('course_id', courseId);

      if (sErr) throw sErr;
    }

    openMarketplace();
  } catch (err) {
    console.error("Publish toggle failed:", err);
    await alert("Failed to update status: " + err.message);
  }
}

export async function deleteCourse(courseId) {
  if (!await confirm("ADMIN: Are you sure you want to delete this course? This action cannot be undone.")) return;

  try {
    const { error } = await supabase
      .from('courses')
      .delete()
      .eq('id', courseId);

    if (error) throw error;

    await alert("Course deleted successfully.");
    openMarketplace();

  } catch (err) {
    console.error("Delete failed:", err);
    await alert("Failed to delete course: " + err.message);
  }
}

export async function archiveCourse(courseId) {
  if (!currentUser) return;
  try {
    const { error } = await supabase
      .from('user_courses')
      .update({ is_archived: true })
      .eq('user_id', currentUser.id)
      .eq('course_id', courseId);
    if (error) throw error;
    Bus.emit(BUS_EVENT.COURSE_DATA_CHANGED);
    openMarketplace(); // Refresh to show Activate button
  } catch (err) {
    console.error('Archive failed:', err);
    await alert('Failed to archive course: ' + err.message);
  }
}

export async function activateCourse(courseId) {
  if (!currentUser) return;
  try {
    const { error } = await supabase
      .from('user_courses')
      .update({ is_archived: false })
      .eq('user_id', currentUser.id)
      .eq('course_id', courseId);
    if (error) throw error;
    await alert("Course activated! Let's start learning.");
    closeMarketplace();
    await fetchCourses();
    await setActiveCourse(courseId);
    openSidebar();
  } catch (err) {
    console.error('Activate failed:', err);
    await alert('Failed to activate course: ' + err.message);
  }
}

export async function unlockCourse(courseId, isPaid) {
  if (!currentUser) {
    await alert("Please sign in to unlock courses.");
    // Maybe show auth modal?
    return;
  }

  if (isPaid) {
    // Placeholder for Stripe/Payments
    await alert("Payment integration coming soon! (This is a paid course)");
    return;
  }

  const btn = document.activeElement;
  if (btn) {
    btn.textContent = "Unlocking...";
    btn.disabled = true;
  }

  try {
    const { error } = await supabase
      .from('user_courses')
      .insert([{ user_id: currentUser.id, course_id: courseId }]);

    if (error) throw error;

    // Success! COURSE_UNLOCKED event will refresh the sidebar and select the new course.
    // Success — directly refresh sidebar and select the course.
    closeMarketplace();
    await fetchCourses();
    await setActiveCourse(courseId);
    openSidebar();
    Bus.emit(BUS_EVENT.COURSE_DATA_CHANGED); // notify any other listeners (e.g. glossary)

  } catch (err) {
    console.error("Unlock failed:", err);
    await alert("Failed to unlock course. Please try again.");
    if (btn) {
      btn.textContent = "Get Course";
      btn.disabled = false;
    }
  }
}

export function closeMarketplace() {
  if (!marketplaceModal) return;
  marketplaceModal.classList.remove('open');
  marketplaceModal.setAttribute('aria-hidden', 'true');
}

export function initCourseMarketplace() {
  marketplaceModal = document.getElementById('marketplaceModal');
  closeMarketBtn = document.getElementById('closeMarketBtn');
  marketGrid = document.getElementById('marketGrid');

  // Event Delegation for Marketplace
  marketGrid?.addEventListener('click', async (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;

    const action = target.dataset.action;
    const id = target.dataset.id;
    const status = target.dataset.status === 'true';
    const isPaid = target.dataset.paid === 'true';

    if (action === 'toggle-publish') {
      togglePublish(id, status);
    } else if (action === 'delete-course') {
      deleteCourse(id);
    } else if (action === 'unlock-course') {
      unlockCourse(id, isPaid);
    } else if (action === 'archive-course') {
      archiveCourse(id);
    } else if (action === 'activate-course') {
      activateCourse(id);
    }
  });

  closeMarketBtn?.addEventListener('click', closeMarketplace);
  marketplaceModal?.addEventListener('click', (e) => {
    if (e.target === marketplaceModal) closeMarketplace();
  });
}
