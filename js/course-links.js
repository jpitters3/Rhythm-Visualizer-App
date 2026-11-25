// Direct course links: ?course=<slug> opens the course, and ?course=<slug>&edit=1
// opens it in the Course Creator (admins). The slug is the title, hyphenated.

import { supabase, SUPABASE_URL } from './supabase-client.js';
import { currentUser, isAdminUser } from './state.js';
import { Bus, BUS_EVENT } from './bus.js';
import { navigate } from './router.js';
import { alert } from './alert.js';

export const PRODUCTION_APP_URL = 'https://panafide.com';
const PRODUCTION_PROJECT = 'ycdlqkaymkgpbpgtqubs';

export const isProduction = () => SUPABASE_URL.includes(PRODUCTION_PROJECT);

// Same rule as supabase/functions/course-sync/plan.ts.
export function courseSlug(title) {
  return String(title ?? '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function courseLink(title, { edit = false, origin = location.origin + location.pathname } = {}) {
  const url = new URL(origin);
  url.searchParams.set('course', courseSlug(title));
  if (edit) url.searchParams.set('edit', '1');
  return url.toString();
}

export const productionEditLink = (title) => courseLink(title, { edit: true, origin: `${PRODUCTION_APP_URL}/` });

function clearParams() {
  const url = new URL(location.href);
  url.searchParams.delete('course');
  url.searchParams.delete('edit');
  history.replaceState(history.state, '', url);
}

// Published first, then newest, when two titles share a slug.
async function findCourse(slug) {
  const { data, error } = await supabase
    .from('courses')
    .select('id, title, is_published, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  const matches = (data || []).filter(c => courseSlug(c.title) === slug);
  return matches.find(c => c.is_published) ?? matches[0] ?? null;
}

async function openForEditing(courseId) {
  const { data: course, error } = await supabase
    .from('courses')
    .select('*, sections(*, lessons(*))')
    .eq('id', courseId)
    .single();
  if (error) throw error;
  const { loadCourseToEdit } = await import('./course-creator.js');
  loadCourseToEdit(course);
}

async function openForLearning(course) {
  const { data: enrolled } = currentUser
    ? await supabase.from('user_courses').select('course_id')
      .eq('user_id', currentUser.id).eq('course_id', course.id).eq('is_archived', false).maybeSingle()
    : { data: null };
  const { data: owned } = currentUser
    ? await supabase.from('courses').select('id').eq('id', course.id).eq('owner_id', currentUser.id).maybeSingle()
    : { data: null };

  if (enrolled || owned) {
    navigate('studio');
    Bus.emit(BUS_EVENT.OPEN_COURSE, { courseId: course.id });
  } else {
    const { openMarketplace } = await import('./course-marketplace.js');
    openMarketplace({ search: course.title });
  }
}

let handled = false;

// Called once the app (and auth) has started; also retried at sign-in, since
// an edit link needs an admin.
export async function openCourseFromURL() {
  const params = new URLSearchParams(location.search);
  const slug = params.get('course');
  if (!slug || handled) return;
  const wantsEdit = params.get('edit') === '1';
  if (wantsEdit && !isAdminUser(currentUser)) {
    if (!currentUser) Bus.emit(BUS_EVENT.OPEN_AUTH_MODAL);
    else { handled = true; clearParams(); await alert('Only admins can edit courses.'); }
    return;
  }

  handled = true;
  clearParams();
  try {
    const course = await findCourse(slug);
    if (!course) {
      await alert('That course link doesn’t match any course.');
      return;
    }
    if (wantsEdit) await openForEditing(course.id);
    else await openForLearning(course);
  } catch (err) {
    console.error('[course-links]', err);
    await alert('Couldn’t open that course. Try again.');
  }
}

export function initCourseLinks() {
  Bus.on(BUS_EVENT.AUTH_LOGIN, () => openCourseFromURL());
}
