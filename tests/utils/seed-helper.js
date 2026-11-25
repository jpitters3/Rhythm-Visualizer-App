// Seeds course/lesson/phrase data straight into Supabase through the admin
// client, so tests can start from a known state without driving the admin UI.
const { supabaseAdmin } = require('./auth-helper');

const DEMO_PATTERN = {
  labels: ['1', '', '2', '', '3', '', '4', ''],
  hands: [],
  flams: [],
  beats: 4,
  subdivision: 2,
  measures: 1,
  bpm: 90,
};

async function must(query, what) {
  const { data, error } = await query;
  if (error) throw new Error(`Failed to seed ${what}: ${error.message}`);
  return data;
}

// Creates a published course owned by `ownerId`: one published section per
// entry in `sections`, each an array of lesson titles. Returns the course and
// a flat, ordered list of its lessons.
async function seedCourse(ownerId, { title, sections = [['Lesson One']] } = {}) {
  const course = await must(
    supabaseAdmin.from('courses').insert({
      title: title || `Seeded Course ${Date.now()}`,
      description: 'Seeded for tests',
      owner_id: ownerId,
      is_published: true,
    }).select().single(),
    'course'
  );

  const lessons = [];
  for (const [si, lessonTitles] of sections.entries()) {
    const section = await must(
      supabaseAdmin.from('sections').insert({
        course_id: course.id, title: `Section ${si + 1}`, order_index: si, is_published: true,
      }).select().single(),
      'section'
    );
    for (const [li, lessonTitle] of lessonTitles.entries()) {
      lessons.push(await must(
        supabaseAdmin.from('lessons').insert({
          section_id: section.id,
          title: lessonTitle,
          order_index: li,
          description: `Description for ${lessonTitle}`,
          pattern_name: 'demo',
          pattern_json: DEMO_PATTERN,
        }).select().single(),
        'lesson'
      ));
    }
  }
  return { course, lessons };
}

async function enroll(userId, courseId) {
  await must(supabaseAdmin.from('user_courses').insert({ user_id: userId, course_id: courseId }), 'enrollment');
}

// Sections and lessons are removed explicitly rather than relying on cascades.
async function deleteCourse(courseId) {
  const { data: sections } = await supabaseAdmin.from('sections').select('id').eq('course_id', courseId);
  const sectionIds = (sections || []).map(s => s.id);
  if (sectionIds.length) {
    const { data: lessons } = await supabaseAdmin.from('lessons').select('id').in('section_id', sectionIds);
    const lessonIds = (lessons || []).map(l => l.id);
    if (lessonIds.length) await supabaseAdmin.from('user_lesson_progress').delete().in('lesson_id', lessonIds);
    await supabaseAdmin.from('lessons').delete().in('section_id', sectionIds);
  }
  await supabaseAdmin.from('sections').delete().eq('course_id', courseId);
  await supabaseAdmin.from('user_courses').delete().eq('course_id', courseId);
  await supabaseAdmin.from('courses').delete().eq('id', courseId);
}

async function deleteCoursesByTitle(title) {
  const { data } = await supabaseAdmin.from('courses').select('id').eq('title', title);
  for (const { id } of data || []) await deleteCourse(id);
}

// Titles the specs give the courses they create; each ends in a Date.now() stamp.
const TEST_COURSE_TITLE = /^(LessonPlayerTest|LessonSettingsTest|E2E Beginner Course|Practice Test Course|Rhythm Basics|Dashboard Course|Test Marketplace Course|Clean Test Course|Course to Update|MC Test Course|Seeded Course|Cleanup Probe) .*\d{13}/;
const PRODUCTION_PROJECT = 'ycdlqkaymkgpbpgtqubs';

// Safety net for runs that were killed before their cleanup ran. Only touches
// courses older than `olderThanMinutes`, so a run going on elsewhere keeps its own.
async function sweepTestCourses({ olderThanMinutes = 60 } = {}) {
  if (String(process.env.VITE_SUPABASE_URL).includes(PRODUCTION_PROJECT)) return 0;
  const cutoff = new Date(Date.now() - olderThanMinutes * 60000).toISOString();
  const { data, error } = await supabaseAdmin.from('courses').select('id, title').lt('created_at', cutoff);
  if (error) throw error;
  const stale = (data || []).filter(c => TEST_COURSE_TITLE.test(c.title));
  for (const { id } of stale) await deleteCourse(id);
  return stale.length;
}

async function seedPattern(userId, name, data = DEMO_PATTERN) {
  await must(
    supabaseAdmin.from('patterns').insert({
      user_id: userId, name, data, source: 'manual', updated_at: new Date().toISOString(),
    }),
    `pattern "${name}"`
  );
}

// Removes everything a test user might have created in the Library/Composer.
async function deleteUserContent(userId) {
  const { data: comps } = await supabaseAdmin.from('compositions').select('id').eq('user_id', userId);
  const compIds = (comps || []).map(c => c.id);
  if (compIds.length) {
    await supabaseAdmin.from('composition_sections').delete().in('composition_id', compIds);
    await supabaseAdmin.from('compositions').delete().in('id', compIds);
  }
  await supabaseAdmin.from('patterns').delete().eq('user_id', userId);
}

module.exports = {
  DEMO_PATTERN, seedCourse, enroll, deleteCourse, deleteCoursesByTitle, sweepTestCourses,
  seedPattern, deleteUserContent, TEST_COURSE_TITLE,
};
