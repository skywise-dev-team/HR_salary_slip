/**
 * One-time migration: restore app access for employees who were only ever
 * logging in through a stale `users` row (left over from before Employee
 * Master had its own login system) rather than a properly-provisioned
 * Employee Master login.
 *
 * Context: auth.js now correctly excludes any `users` row that shadows an
 * Employee Master record from login — this closes a real bug where such a
 * stale row would grant an ordinary employee unrestricted, full-visibility
 * access instead of their own self-service view. But for any employee who
 * was ONLY ever accessing the app through that old stale account (and was
 * never explicitly granted "App Access: Yes" through Employee Master
 * itself), that fix also means they can no longer log in at all — the
 * "Invalid credentials" they now see is the fix correctly rejecting an
 * account with no real Employee Master access configured, not a bug.
 *
 * This script finds every such employee, grants them proper app access on
 * their own Employee Master record (password = their own Employee ID,
 * forced to change it at next sign-in — the same convention Employee
 * Master already uses everywhere else), and then removes the old stale
 * `users` row, in one pass for everyone affected — so you don't have to
 * click through Employee Master one employee at a time.
 *
 * SAFE TO RE-RUN: an employee who already has App Access = Yes is left
 * completely untouched (their existing password is never reset just for
 * running this again) — only employees who currently have no real access
 * configured are migrated.
 *
 * HOW TO RUN:
 *   cd backend
 *   node src/config/migrate_stale_employee_logins.js
 */
const bcrypt = require('bcryptjs');
const pool = require('./db');

async function migrate() {
  // Every users-table row that shadows an Employee Master record — these
  // are exactly the stale accounts the login fix now excludes.
  const [staleRows] = await pool.query(
    `SELECT u.id AS user_row_id, u.user_id
     FROM users u
     WHERE EXISTS (SELECT 1 FROM employees e WHERE e.employee_id = u.user_id)
       AND u.user_id != 'admin'`
  );

  if (!staleRows.length) {
    console.log('No stale employee-shadowing rows found in `users`. Nothing to migrate.');
    process.exit(0);
  }

  console.log(`Found ${staleRows.length} stale account(s) to review:\n`);

  let migrated = 0;
  let alreadyOk = 0;

  for (const row of staleRows) {
    const [[emp]] = await pool.query(
      'SELECT id, employee_id, app_access FROM employees WHERE employee_id = ?',
      [row.user_id]
    );
    if (!emp) continue; // shouldn't happen given the EXISTS check above, but guard anyway

    if (emp.app_access === 'YES') {
      console.log(`  ${emp.employee_id}: already has proper App Access — left untouched.`);
      alreadyOk++;
      continue;
    }

    const passwordHash = await bcrypt.hash(emp.employee_id, 10);
    await pool.query(
      `UPDATE employees SET app_access = 'YES', password_hash = ?, must_change_password = 1 WHERE id = ?`,
      [passwordHash, emp.id]
    );
    console.log(`  ${emp.employee_id}: granted App Access = Yes, password reset to their Employee ID.`);
    migrated++;
  }

  // Now that every affected employee has real access on their own
  // Employee Master record, the old stale users-table rows can go.
  const placeholders = staleRows.map(() => '?').join(',');
  const [result] = await pool.query(
    `DELETE FROM users WHERE id IN (${placeholders})`,
    staleRows.map((r) => r.user_row_id)
  );

  console.log(`\nDone. ${migrated} employee(s) migrated, ${alreadyOk} already had proper access, ${result.affectedRows} stale row(s) removed from users.`);
  console.log('Every migrated employee can now sign in with their Employee ID as both username and password, and will be asked to set a new password.');
  process.exit(0);
}

migrate().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
