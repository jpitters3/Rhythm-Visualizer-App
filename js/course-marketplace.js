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
      .select('id, title, description, price, is_paid, thumbnail_url, owner_id')
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

  if (courses.length === 0) {
    marketGrid.innerHTML = '<p>No courses available right now.</p>';
    return;
  }

  const isAdmin = typeof isAdminUser === 'function' ? isAdminUser(currentUser) : false;

  courses.forEach(course => {
    const isOwned = ownedIds.has(course.id);
    const isPaid = course.is_paid;
    const priceDisplay = isPaid ? `$${course.price}` : 'Free';

    // Badge
    let badgeClass = 'free';
    let badgeText = 'FREE';
    if (isPaid) {
      badgeClass = 'paid';
      badgeText = `$${course.price}`;
    }
    if (isOwned) {
      badgeClass = 'free'; // Just use green for owned? Or maybe hide badge?
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
      btnAction = ''; // No action or maybe 'Open'
    }

    const card = document.createElement('div');
    card.className = `market-card ${isPaid ? 'premium' : ''}`;

    // Thumbnail placeholder if null
    const thumbStyle = course.thumbnail_url
      ? `background-image: url('${course.thumbnail_url}')`
      : `background: linear-gradient(135deg, #1e3c72, #2a5298)`; // fallback gradient

    let adminActions = '';
    if (isAdmin) {
      adminActions = `
            <button class="market-btn" 
                onclick="deleteCourse('${course.id}')" 
                style="background-color: #e74c3c; margin-top: 8px; border: none;">
                Delete
            </button>
        `;
    }

    card.innerHTML = `
      <div class="card-thumb" style="${thumbStyle}">
        <div class="price-badge ${badgeClass}">${badgeText}</div>
      </div>
      <div class="card-content">
        <h3 class="card-title">${course.title}</h3>
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
