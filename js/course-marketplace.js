// ===== COURSE MARKETPLACE LOGIC =====

const marketplaceModal = document.getElementById('marketplaceModal');
const closeMarketBtn = document.getElementById('closeMarketBtn');
const marketGrid = document.getElementById('marketGrid');

window.openMarketplace = async function () {
  if (!marketplaceModal) return;

  marketplaceModal.classList.add('open');
  marketplaceModal.setAttribute('aria-hidden', 'false');

  marketGrid.innerHTML = '<div class="loading-spinner">Loading courses...</div>';

  try {
    // 1. Fetch ALL courses
    const { data: allCourses, error: cErr } = await supabase1
      .from('courses')
      .select('id, title, description, price, is_paid, thumbnail_url, owner_id, is_published')
      .order('created_at', { ascending: false });

    if (cErr) throw cErr;

    // 2. Fetch User's Owned Courses
    let ownedIds = new Set();
    if (currentUser) {
      const { data: result, error: uErr } = await supabase1
        .from('user_courses')
        .select('course_id')
        .eq('user_id', currentUser.id);

      if (!uErr && result) {
        result.forEach(r => ownedIds.add(r.course_id));
      }

      // Also owner owns their own courses
      allCourses.forEach(c => {
        if (c.owner_id === currentUser.id) ownedIds.add(c.id);
      });
    }

    renderMarketplace(allCourses || [], ownedIds);

  } catch (err) {
    console.error("Error loading marketplace:", err);
    marketGrid.innerHTML = '<div style="color:red">Failed to load courses.</div>';
  }
};

function renderMarketplace(courses, ownedIds) {
  marketGrid.innerHTML = '';

  const isAdmin = typeof isAdminUser === 'function' ? isAdminUser(currentUser) : false;

  // Filter: If NOT admin, show only published
  const visibleCourses = courses.filter(c => {
    if (isAdmin) return true; // Admins see everything
    return c.is_published === true;
  });

  if (visibleCourses.length === 0) {
    marketGrid.innerHTML = '<p>No courses available right now.</p>';
    return;
  }

  visibleCourses.forEach(course => {
    const isOwned = ownedIds.has(course.id);
    const isPaid = course.is_paid;
    const isPublished = course.is_published; // explicitly check boolean logic if needed, but truthy works for true

    // Badge
    let badgeClass = 'free';
    let badgeText = 'FREE';
    if (isPaid) {
      badgeClass = 'paid';
      badgeText = `$${course.price}`;
    }

    // Admin Draft Badge override
    if (isAdmin && !isPublished) {
      badgeClass = 'paid'; // reusing 'paid' color (often red/orange) or custom
      badgeText = 'DRAFT';
    } else if (isOwned && isPublished) {
      // Only show "OWNED" if it's actually published (or if admin is viewing a published course they own)
      badgeClass = 'free';
      badgeText = 'OWNED';
    }

    // Button State
    let btnClass = 'market-btn get';
    let btnText = 'Get Course';
    let btnAction = `unlockCourse('${course.id}', ${isPaid})`;

    if (isPaid) {
      btnClass = 'market-btn buy';
      btnText = 'Buy Course';
    }

    if (isOwned) {
      btnClass = 'market-btn owned';
      btnText = 'Owned';
      btnAction = '';
    }

    const card = document.createElement('div');
    card.className = `market-card ${isPaid ? 'premium' : ''}`;
    // Visual opacity for draft
    if (!isPublished) card.style.opacity = '0.85';

    // Thumbnail placeholder if null
    const thumbStyle = course.thumbnail_url
      ? `background-image: url('${course.thumbnail_url}')`
      : `background: linear-gradient(135deg, #1e3c72, #2a5298)`;

    let adminActions = '';
    if (isAdmin) {
      const publishLabel = isPublished ? 'Unpublish' : 'Publish';
      const publishColor = isPublished ? '#f39c12' : '#27ae60'; // Orange to unpublish, Green to publish

      adminActions = `
            <div style="display:flex; gap:8px; margin-top:8px;">
                <button class="market-btn" 
                    onclick="togglePublish('${course.id}', ${isPublished})" 
                    style="background-color: ${publishColor}; border: none; flex:1;">
                    ${publishLabel}
                </button>
                <button class="market-btn" 
                    onclick="deleteCourse('${course.id}')" 
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
          ${isOwned ? 'disabled' : ''} 
          onclick="${btnAction}">
          ${btnText}
        </button>
        ${adminActions}
      </div>
    `;

    marketGrid.appendChild(card);
  });
}

window.togglePublish = async function (courseId, currentStatus) {
  const newStatus = !currentStatus;
  const action = newStatus ? "PUBLISH" : "UNPUBLISH";

  if (!confirm(`ADMIN: Are you sure you want to ${action} this course?`)) return;

  try {
    // 1. Update Course
    const { error: cErr } = await supabase1
      .from('courses')
      .update({ is_published: newStatus })
      .eq('id', courseId);

    if (cErr) throw cErr;

    // 2. Cascade to Sections (ONLY if Publishing)
    // If Unpublishing, we hide the course, so sections state doesn't really matter (safe to leave as-is)
    // But if Publishing, we want to ensure valid content is visible.
    if (newStatus === true) {
      const { error: sErr } = await supabase1
        .from('sections')
        .update({ is_published: true })
        .eq('course_id', courseId);

      if (sErr) throw sErr;
    }

    // Reload
    openMarketplace();
  } catch (err) {
    console.error("Publish toggle failed:", err);
    alert("Failed to update status: " + err.message);
  }
};

window.deleteCourse = async function (courseId) {
  if (!confirm("ADMIN: Are you sure you want to delete this course? This action cannot be undone.")) return;

  try {
    const { error } = await supabase1
      .from('courses')
      .delete()
      .eq('id', courseId);

    if (error) throw error;

    alert("Course deleted successfully.");
    // Reload
    openMarketplace();

  } catch (err) {
    console.error("Delete failed:", err);
    alert("Failed to delete course: " + err.message);
  }
};

window.unlockCourse = async function (courseId, isPaid) {
  if (!currentUser) {
    alert("Please sign in to unlock courses.");
    // Maybe show auth modal?
    return;
  }

  if (isPaid) {
    // Placeholder for Stripe/Payments
    alert("Payment integration coming soon! (This is a paid course)");
    return;
  }

  // FREE COURSE UNLOCK
  const btn = document.activeElement;
  if (btn) {
    btn.textContent = "Unlocking...";
    btn.disabled = true;
  }

  try {
    const { error } = await supabase1
      .from('user_courses')
      .insert([{ user_id: currentUser.id, course_id: courseId }]);

    if (error) throw error;

    // Success!
    // 1. Auto-set as active course in profile
    await setActiveCourse(courseId);

    alert("Course unlocked! It has been added to your library.");
    closeMarketplace();

    // Refresh sidebar
    if (window.fetchCourses) window.fetchCourses();

  } catch (err) {
    console.error("Unlock failed:", err);
    alert("Failed to unlock course. Please try again.");
    if (btn) {
      btn.textContent = "Get Course";
      btn.disabled = false;
    }
  }
};

function closeMarketplace() {
  if (!marketplaceModal) return;
  marketplaceModal.classList.remove('open');
}

closeMarketBtn?.addEventListener('click', closeMarketplace);
marketplaceModal?.addEventListener('click', (e) => {
  if (e.target === marketplaceModal) closeMarketplace();
});
