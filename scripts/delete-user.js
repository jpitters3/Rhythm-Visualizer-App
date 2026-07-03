#!/usr/bin/env node
/**
 * delete-user.js
 * Deletes all data for a given user, then deletes the auth account itself.
 *
 * Usage:
 *   node scripts/delete-user.js <email-or-user-id>
 *
 * Requires env vars (or a .env file):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY   ← must be service role, not anon key
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const TARGET = process.argv[2];
if (!TARGET) {
  console.error('Usage: node scripts/delete-user.js <email-or-user-id>');
  process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing env vars. Required in .env:');
  console.error('  SUPABASE_URL (or VITE_SUPABASE_URL)');
  console.error('  SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ─── Resolve user ID ────────────────────────────────────────────────────────

async function resolveUserId(emailOrId) {
  // If it looks like a UUID, use it directly
  if (/^[0-9a-f-]{36}$/i.test(emailOrId)) return emailOrId;

  // Otherwise look up by email via admin API
  const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw new Error(`Failed to list users: ${error.message}`);
  const user = data.users.find(u => u.email === emailOrId);
  if (!user) throw new Error(`No user found with email: ${emailOrId}`);
  return user.id;
}

// ─── Delete storage files ────────────────────────────────────────────────────

async function deleteStorageFolder(bucket, prefix) {
  const { data: files, error } = await supabase.storage.from(bucket).list(prefix, { limit: 1000 });
  if (error) { console.warn(`  Storage list failed (${bucket}/${prefix}):`, error.message); return; }
  if (!files?.length) return;

  const paths = files.map(f => `${prefix}/${f.name}`);
  const { error: delError } = await supabase.storage.from(bucket).remove(paths);
  if (delError) console.warn(`  Storage delete failed (${bucket}/${prefix}):`, delError.message);
  else console.log(`  Deleted ${paths.length} file(s) from ${bucket}/${prefix}`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function deleteUser(emailOrId) {
  console.log(`\nResolving user: ${emailOrId}`);
  const userId = await resolveUserId(emailOrId);
  console.log(`User ID: ${userId}\n`);

  // 1. Storage buckets (must go first — files are not DB rows)
  console.log('Deleting storage files...');
  await deleteStorageFolder('composition-audio', userId);
  await deleteStorageFolder('user-clips', userId);

  // Assignment submissions are stored under student_id paths
  await deleteStorageFolder('assignment-submissions', userId);

  // 2. Database rows — ordered to respect foreign keys (children before parents)
  const tables = [
    // Leaf / child tables first
    { table: 'practice_history',          column: 'user_id' },
    { table: 'practice_items',            column: 'user_id' },
    { table: 'user_lesson_progress',      column: 'user_id' },
    { table: 'user_courses',              column: 'user_id' },
    { table: 'notifications',             column: 'user_id' },
    { table: 'notification_preferences',  column: 'user_id' },
    { table: 'clips',                     column: 'user_id' },
    { table: 'shared_patterns',           column: 'user_id' },
    { table: 'library_folders',           column: 'user_id' },
    { table: 'patterns',                  column: 'user_id' },
    // compositions cascade-deletes composition_sections
    { table: 'compositions',              column: 'user_id' },
    // Assignments (teacher side)
    { table: 'assignment_folders',        column: 'created_by' },
    // student_assignments + assignment_submissions cascade from assignments
    { table: 'assignments',               column: 'created_by' },
    // Student side of assignments
    { table: 'student_assignments',       column: 'student_id' },
    // Teacher–student relationships
    { table: 'teacher_invitations',       column: 'teacher_id' },
    { table: 'teacher_invitations',       column: 'student_id' },
    { table: 'teacher_students',          column: 'teacher_id' },
    { table: 'teacher_students',          column: 'student_id' },
    { table: 'student_sessions',          column: 'teacher_id' },
    { table: 'student_sessions',          column: 'student_id' },
    // Profile last — other tables may reference it
    { table: 'profiles',                  column: 'user_id' },
  ];

  console.log('Deleting database rows...');
  for (const { table, column } of tables) {
    const { error, count } = await supabase
      .from(table)
      .delete({ count: 'exact' })
      .eq(column, userId);

    if (error) {
      console.warn(`  ⚠️  ${table}.${column}: ${error.message}`);
    } else if (count > 0) {
      console.log(`  ✓  ${table}.${column}: deleted ${count} row(s)`);
    }
  }

  // 3. Delete the auth user itself (requires service role)
  console.log('\nDeleting auth user...');
  const { error: authError } = await supabase.auth.admin.deleteUser(userId);
  if (authError) {
    console.error(`  ✗  Auth delete failed: ${authError.message}`);
    process.exit(1);
  }

  console.log(`  ✓  Auth user deleted.\n`);
  console.log(`Done. User ${emailOrId} has been fully removed.`);
}

deleteUser(TARGET).catch(err => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
