/**
 * course-sync (deploy to STAGING only)
 *
 * Admin-only course moves for the Manage Courses page (js/manage-courses.js):
 *   { action: 'list' }                         → { courses: compareCourses rows }
 *   { action: 'publish', courseId, dryRun? }   → new staging course → production
 *   { action: 'pull', courseId }               → production course → staging (overwrites)
 *   { action: 'delete', courseIds }            → deletes staging courses
 *
 * Secrets: PROD_SUPABASE_URL, PROD_SERVICE_ROLE_KEY. Rules live in plan.ts.
 */

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { adminUser, serviceClient } from '../_shared/admin.ts'
import { checkPublish, compareCourses, planCopy, SyncError, type Course } from './plan.ts'

const MAX_DELETE = 200
const SUMMARY = 'id, title, is_published, sections(id, lessons(id))'
const TREE = `id, owner_id, title, description, created_at, updated_at, is_paid, price, thumbnail_url,
  is_published, progression_id, category, tags, intended_scale, level, preview_lesson_id,
  sections(id, course_id, title, order_index, created_at, is_published,
    lessons(id, section_id, title, description, video_url, pattern_json, order_index, created_at, pattern_name, app_link))`

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

interface Side { db: SupabaseClient, base: string }

function sides(): { staging: Side, production: Side } {
  const stagingUrl = Deno.env.get('SUPABASE_URL')!
  const prodUrl = Deno.env.get('PROD_SUPABASE_URL')
  const prodKey = Deno.env.get('PROD_SERVICE_ROLE_KEY')
  if (!prodUrl || !prodKey) throw new SyncError('course-sync needs PROD_SUPABASE_URL and PROD_SERVICE_ROLE_KEY.', 500)
  if (prodUrl === stagingUrl) throw new SyncError('course-sync runs on staging only.', 500)
  return {
    staging: { db: serviceClient(), base: stagingUrl },
    production: { db: createClient(prodUrl, prodKey), base: prodUrl },
  }
}

async function must<T>(query: PromiseLike<{ data: T, error: unknown }>): Promise<T> {
  const { data, error } = await query
  if (error) throw error
  return data
}

const summaries = (side: Side) => must(side.db.from('courses').select(SUMMARY))

async function loadTree(side: Side, courseId: string) {
  const course = await must(side.db.from('courses').select(TREE).eq('id', courseId).maybeSingle())
  if (!course) throw new SyncError('Course not found.', 404)
  return course as unknown as Course
}

async function userIdByEmail(db: SupabaseClient, email: string | undefined) {
  if (!email) return null
  const { data, error } = await db.rpc('user_id_by_email', { p_email: email })
  if (!error) return (data as string | null) ?? null
  for (let page = 1; page <= 20; page++) {
    const { data: list } = await db.auth.admin.listUsers({ page, perPage: 1000 })
    const hit = list?.users.find(u => u.email?.toLowerCase() === email.toLowerCase())
    if (hit) return hit.id
    if (!list || list.users.length < 1000) break
  }
  return null
}

// The course's owner in the target project, matched by email; else the admin doing the move.
async function targetOwner(from: Side, to: Side, ownerId: string, adminEmail: string | undefined) {
  const { data } = await from.db.auth.admin.getUserById(ownerId)
  const owner = await userIdByEmail(to.db, data?.user?.email) ?? await userIdByEmail(to.db, adminEmail)
  if (!owner) throw new SyncError('Couldn’t find the course owner (or you) in the other project.', 409)
  return owner
}

async function copyObjects(from: Side, to: Side, objects: { bucket: string, path: string }[]) {
  const failed: string[] = []
  for (const { bucket, path } of objects) {
    const { data: blob, error } = await from.db.storage.from(bucket).download(path)
    if (error || !blob) { failed.push(path); continue }
    const { error: upErr } = await to.db.storage.from(bucket)
      .upload(path, blob, { upsert: true, contentType: blob.type || undefined })
    if (upErr) failed.push(path)
  }
  return failed
}

// Writes `course` into `to` with the same ids, and removes sections/lessons
// that `to` has but `course` doesn't.
async function copyCourse(from: Side, to: Side, course: Course, adminEmail: string | undefined) {
  const ownerId = await targetOwner(from, to, course.owner_id, adminEmail)
  const progressionExists = !!course.progression_id && !!await must(
    to.db.from('progressions').select('id').eq('id', course.progression_id).maybeSingle())
  const plan = planCopy(course, { fromBase: from.base, toBase: to.base, ownerId, progressionExists })

  const failedFiles = await copyObjects(from, to, plan.objects)

  await must(to.db.from('courses').upsert(plan.course))
  if (plan.sections.length) await must(to.db.from('sections').upsert(plan.sections))
  if (plan.lessons.length) await must(to.db.from('lessons').upsert(plan.lessons))

  const keepSections = new Set(plan.sections.map(s => s.id))
  const keepLessons = new Set(plan.lessons.map(l => l.id))
  const existing = await must(to.db.from('sections').select('id, lessons(id)').eq('course_id', course.id)) as
    { id: string, lessons: { id: string }[] }[]
  const staleLessons = existing.flatMap(s => s.lessons.map(l => l.id)).filter(id => !keepLessons.has(id))
  const staleSections = existing.map(s => s.id).filter(id => !keepSections.has(id))
  if (staleLessons.length) await must(to.db.from('lessons').delete().in('id', staleLessons))
  if (staleSections.length) await must(to.db.from('sections').delete().in('id', staleSections))

  if (plan.previewLessonId) {
    await must(to.db.from('courses').update({ preview_lesson_id: plan.previewLessonId }).eq('id', course.id))
  }
  return { sections: plan.sections.length, lessons: plan.lessons.length, failedFiles }
}

async function deleteCourses(side: Side, ids: string[]) {
  const sections = await must(side.db.from('sections').select('id').in('course_id', ids)) as { id: string }[]
  const sectionIds = sections.map(s => s.id)
  if (sectionIds.length) {
    await must(side.db.from('lessons').delete().in('section_id', sectionIds))
    await must(side.db.from('sections').delete().in('id', sectionIds))
  }
  await must(side.db.from('profiles').update({ current_course_id: null }).in('current_course_id', ids))
  await must(side.db.from('user_courses').delete().in('course_id', ids))
  await must(side.db.from('courses').delete().in('id', ids))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const admin = await adminUser(req)
  if (!admin) return reply({ error: 'Admins only' }, 403)

  let body: any
  try {
    body = await req.json()
  } catch {
    return reply({ error: 'Invalid JSON' }, 400)
  }

  try {
    const { staging, production } = sides()

    if (body?.action === 'list') {
      const [s, p] = await Promise.all([summaries(staging), summaries(production)])
      return reply({ courses: compareCourses(s as any, p as any), productionUrl: production.base })
    }

    if (body?.action === 'publish') {
      const course = await loadTree(staging, String(body.courseId ?? ''))
      checkPublish(course, await summaries(production) as any)
      if (body.dryRun) return reply({ ok: true, dryRun: true })
      const result = await copyCourse(staging, production, course, admin.email)
      console.log('[course-sync] published', course.id, course.title)
      return reply({ ok: true, ...result })
    }

    if (body?.action === 'pull') {
      const course = await loadTree(production, String(body.courseId ?? ''))
      const result = await copyCourse(production, staging, course, admin.email)
      console.log('[course-sync] pulled', course.id, course.title)
      return reply({ ok: true, ...result })
    }

    if (body?.action === 'delete') {
      const ids = [...new Set((Array.isArray(body.courseIds) ? body.courseIds : []).map(String))]
      if (!ids.length) return reply({ error: 'No courses chosen' }, 400)
      if (ids.length > MAX_DELETE) return reply({ error: `At most ${MAX_DELETE} at a time` }, 400)
      await deleteCourses(staging, ids)
      console.log('[course-sync] deleted', ids.length, 'staging courses')
      return reply({ ok: true, deleted: ids.length })
    }

    return reply({ error: 'action must be list, publish, pull or delete' }, 400)
  } catch (err) {
    if (err instanceof SyncError) return reply({ error: err.message }, err.status)
    console.error('[course-sync]', err)
    return reply({ error: (err as { message?: string })?.message || 'Something went wrong' }, 500)
  }
})
