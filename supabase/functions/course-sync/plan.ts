// Rules for moving courses between staging and production.
// Free of Deno/Supabase imports so tests/course-sync.spec.js can run it.

export interface Lesson {
  id: string
  section_id: string
  title: string
  description?: string | null
  video_url?: string | null
  pattern_json?: unknown
  pattern_name?: string | null
  order_index: number
  created_at?: string
}

export interface Section {
  id: string
  course_id: string
  title: string
  order_index: number
  is_published?: boolean
  created_at?: string
  lessons?: Lesson[]
}

export interface Course {
  id: string
  owner_id: string
  title: string
  thumbnail_url?: string | null
  progression_id?: string | null
  preview_lesson_id?: string | null
  is_published?: boolean
  sections?: Section[]
  [key: string]: unknown
}

export interface CourseSummary {
  id: string
  title: string
  is_published: boolean
  sections?: { lessons?: { id: string }[] }[]
}

export class SyncError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

// Same rule as js/course-links.js: the title, lowercased and hyphenated.
export function courseSlug(title: string) {
  return String(title ?? '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// Leftovers from automated tests end in a Date.now() stamp.
export function isTestCourse(title: string) {
  return /\b\d{13}(-[0-9a-f]+)?$/.test(String(title ?? '').trim())
}

const PUBLIC_PATH = '/storage/v1/object/public/'

// A public storage URL in one project, rewritten to the other project, plus
// the object that has to be copied for the new URL to work.
export function moveStorageUrl(url: string | null | undefined, fromBase: string, toBase: string) {
  if (!url || !url.startsWith(fromBase + PUBLIC_PATH)) return { url: url ?? null, object: null }
  const rest = url.slice((fromBase + PUBLIC_PATH).length)
  const slash = rest.indexOf('/')
  if (slash < 1) return { url, object: null }
  const bucket = rest.slice(0, slash)
  const path = decodeURIComponent(rest.slice(slash + 1).split('?')[0])
  return { url: toBase + PUBLIC_PATH + rest, object: { bucket, path } }
}

const count = (c: CourseSummary) => ({
  sections: c.sections?.length ?? 0,
  lessons: (c.sections ?? []).reduce((n, s) => n + (s.lessons?.length ?? 0), 0),
})

// One row per course id across both projects, for the Manage Courses list.
export function compareCourses(staging: CourseSummary[], production: CourseSummary[]) {
  const prodById = new Map(production.map(c => [c.id, c]))
  const stagingIds = new Set(staging.map(c => c.id))
  const rows = staging.map(c => {
    const prod = prodById.get(c.id)
    return {
      id: c.id,
      title: c.title,
      slug: courseSlug(c.title),
      where: prod ? 'both' : 'staging',
      isTest: isTestCourse(c.title),
      staging: { published: !!c.is_published, ...count(c) },
      production: prod ? { published: !!prod.is_published, title: prod.title, ...count(prod) } : null,
    }
  })
  for (const p of production) {
    if (stagingIds.has(p.id)) continue
    rows.push({
      id: p.id,
      title: p.title,
      slug: courseSlug(p.title),
      where: 'production',
      isTest: isTestCourse(p.title),
      staging: null as never,
      production: { published: !!p.is_published, title: p.title, ...count(p) },
    })
  }
  return rows.sort((a, b) => a.title.localeCompare(b.title))
}

// Production only takes brand-new courses; edits happen there directly.
export function checkPublish(course: Course, production: CourseSummary[]) {
  if (production.some(c => c.id === course.id)) {
    throw new SyncError('This course is already on production. Edit it there, then pull it to staging.', 409)
  }
  const slug = courseSlug(course.title)
  const clash = production.find(c => courseSlug(c.title) === slug)
  if (clash) throw new SyncError(`Production already has a course called “${clash.title}”. Rename this one first.`, 409)
  if (isTestCourse(course.title)) throw new SyncError('This looks like a test course, so it wasn’t published.', 400)
}

interface CopyOptions {
  fromBase: string
  toBase: string
  ownerId: string
  progressionExists: boolean
}

// The rows to write into the other project. Ids stay the same, so a course
// keeps one identity (and one link) everywhere.
export function planCopy(course: Course, { fromBase, toBase, ownerId, progressionExists }: CopyOptions) {
  const objects: { bucket: string, path: string }[] = []
  const move = (url: string | null | undefined) => {
    const moved = moveStorageUrl(url, fromBase, toBase)
    if (moved.object) objects.push(moved.object)
    return moved.url
  }

  const { sections = [], ...fields } = course
  const sectionRows: Omit<Section, 'lessons'>[] = []
  const lessonRows: Lesson[] = []
  for (const { lessons = [], ...section } of sections) {
    sectionRows.push({ ...section, course_id: course.id })
    for (const lesson of lessons) {
      lessonRows.push({ ...lesson, section_id: section.id, video_url: move(lesson.video_url) ?? '' })
    }
  }

  const previewId = fields.preview_lesson_id ?? null
  return {
    // The preview lesson is set after the lessons exist (it's a foreign key).
    course: {
      ...fields,
      owner_id: ownerId,
      thumbnail_url: move(fields.thumbnail_url),
      progression_id: progressionExists ? fields.progression_id ?? null : null,
      preview_lesson_id: null,
    },
    previewLessonId: lessonRows.some(l => l.id === previewId) ? previewId : null,
    sections: sectionRows,
    lessons: lessonRows,
    objects,
  }
}
