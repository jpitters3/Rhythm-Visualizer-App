const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function createTestUser() {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 10000);
  const email = `test.user.${timestamp}.${random}@example.com`;
  const password = `TestPass${timestamp}!`;

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      is_admin: true
    }
  });

  if (error) {
    throw new Error(`Failed to create test user: ${error.message}`);
  }

  return {
    email,
    password,
    user: data.user,
  };
}

async function deleteTestUser(userId) {
  const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (error) {
    console.error(`Failed to delete test user ${userId}:`, error.message);
  }
}

module.exports = { createTestUser, deleteTestUser, supabaseAdmin };
