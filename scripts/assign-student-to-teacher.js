/**
 * assign-student-to-teacher.js
 *
 * Silently links a student to a teacher by inserting into teacher_students
 * and teacher_invitations (as accepted), without sending any notification.
 *
 * Usage:
 *   node scripts/assign-student-to-teacher.js <teacher_email> <student_email>
 *
 * Runs against production (.env.prod). Add --staging to use .env instead.
 * Requires: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in that file.
 */

const { scriptArgs } = require('./load-env');

const SUPABASE_URL     = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const [teacherEmail, studentEmail] = scriptArgs;

if (!teacherEmail || !studentEmail) {
  console.error('Usage: node scripts/assign-student-to-teacher.js <teacher_email> <student_email> [--staging]');
  process.exit(1);
}

async function getUserByEmail(email) {
  let page = 1;
  while (true) {
    const res = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=1000`,
      {
        headers: {
          'apikey': SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        },
      }
    );
    const json = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(json));
    const user = json.users?.find(u => u.email?.toLowerCase() === email.toLowerCase());
    if (user) return user;
    if (!json.users || json.users.length < 1000) break;
    page++;
  }
  throw new Error(`No user found with email: ${email}`);
}

async function post(path, body, headers = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'apikey': SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => res.text());
    throw new Error(JSON.stringify(err));
  }
}

async function main() {
  console.log(`Looking up teacher: ${teacherEmail}`);
  const teacher = await getUserByEmail(teacherEmail);
  console.log(`  → ${teacher.id}`);

  console.log(`Looking up student: ${studentEmail}`);
  const student = await getUserByEmail(studentEmail);
  console.log(`  → ${student.id}`);

  // Link student to teacher (idempotent)
  console.log('Linking student to teacher…');
  await post(
    '/rest/v1/teacher_students',
    { teacher_id: teacher.id, student_id: student.id },
    { 'Prefer': 'resolution=ignore-duplicates' }
  );

  console.log(`\nDone. ${studentEmail} is now assigned to ${teacherEmail}.`);
}

main().catch(err => {
  console.error('\nError:', err.message);
  process.exit(1);
});
