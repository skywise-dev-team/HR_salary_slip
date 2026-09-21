-- =================================================================
-- Migration: add Employee Master login/app-access columns
-- =================================================================
-- Run this ONCE against your existing live database. It is NOT run
-- automatically by the application — schema.sql only CREATEs tables
-- that don't exist yet, so it never touches your already-existing
-- `employees` table.
--
-- HOW TO RUN (pick one):
--   1) MySQL Workbench: open this file, click the lightning-bolt
--      "Execute" button.
--   2) Command line:
--        mysql -u <your_user> -p salary_slip < migration_employee_login_access.sql
--      (replace `salary_slip` with your actual database name if different)
--
-- SAFE TO RE-RUN: every statement below uses "IF NOT EXISTS", so
-- running this script twice by mistake does nothing the second time
-- and will not throw an error.
--
-- WHAT THIS DOES:
--   Adds 5 new columns to `employees` so an employee's own app login
--   (Employee ID as username, salary-slip access level) can live
--   directly on their employee record instead of a separate `users`
--   row. Every existing employee row gets safe defaults:
--     - app_access          = 'NO'         (nobody gets access automatically)
--     - salary_slip_access  = 'VIEW_ONLY'  (only matters once app_access is YES)
--     - password_hash       = NULL         (no password until access is granted)
--     - must_change_password = 1           (forces a password change once access is granted)
--     - email               = NULL         (optional, unchanged for existing rows)
--   No existing data is modified or removed. This only adds columns.
-- =================================================================

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS email VARCHAR(150) DEFAULT NULL AFTER status,
  ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255) DEFAULT NULL AFTER email,
  ADD COLUMN IF NOT EXISTS app_access ENUM('YES','NO') NOT NULL DEFAULT 'NO' AFTER password_hash,
  ADD COLUMN IF NOT EXISTS salary_slip_access ENUM('VIEW_DOWNLOAD','VIEW_ONLY','NO_ACCESS') NOT NULL DEFAULT 'VIEW_ONLY' AFTER app_access,
  ADD COLUMN IF NOT EXISTS must_change_password TINYINT(1) NOT NULL DEFAULT 1 AFTER salary_slip_access;

-- After running this, EVERY employee starts with app_access = 'NO' —
-- nobody can sign in as an employee login until an admin explicitly
-- grants access (via Employee Master's Add/Edit form, the quick
-- Active/Inactive toggle, or a bulk Excel re-import with app_access
-- set to YES for the rows that need it).
