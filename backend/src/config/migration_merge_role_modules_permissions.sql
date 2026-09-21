-- =================================================================
-- Migration: merge `role_permissions` into `role_modules`
-- =================================================================
-- Run this ONCE against your existing live database, in order, as one
-- script. Unlike previous migrations, this one MOVES real data before
-- removing a table — read through it once before running.
--
-- HOW TO RUN:
--   mysql -u <your_user> -p salary_slip < migration_merge_role_modules_permissions.sql
--   (replace `salary_slip` with your actual database name if different)
--
-- WHAT THIS DOES AND WHY:
--   role_modules and role_permissions have always been written to
--   together, in lockstep, for the exact same (role_id, module_key)
--   pairs — role_modules just tracks "this role has this module
--   assigned", and role_permissions carries the actual
--   view/edit/delete detail for that same pairing. Since neither one
--   is ever meaningfully used without the other, this merges the
--   view/edit/delete columns directly onto role_modules and removes
--   role_permissions entirely, matching the application code (already
--   updated to read/write only role_modules from now on).
-- =================================================================

-- -----------------------------------------------------------------
-- STEP 1 — VERIFY before doing anything else. This should return ZERO
-- rows. If it returns any rows at all, STOP here and don't run the
-- rest of this script — it means some role has a module assigned in
-- one table but not the other, which the application code should
-- never actually produce, but this confirms your real data matches
-- that assumption before anything is copied or dropped.
-- -----------------------------------------------------------------
SELECT rm.role_id, rm.module_key, 'in role_modules but missing from role_permissions' AS problem
FROM role_modules rm
LEFT JOIN role_permissions rp ON rp.role_id = rm.role_id AND rp.module_key = rm.module_key
WHERE rp.id IS NULL

UNION ALL

SELECT rp.role_id, rp.module_key, 'in role_permissions but missing from role_modules' AS problem
FROM role_permissions rp
LEFT JOIN role_modules rm ON rm.role_id = rp.role_id AND rm.module_key = rp.module_key
WHERE rm.id IS NULL;

-- -----------------------------------------------------------------
-- STEP 2 — add the view/edit/delete columns to role_modules.
-- Safe to re-run (IF NOT EXISTS).
-- -----------------------------------------------------------------
ALTER TABLE role_modules
  ADD COLUMN IF NOT EXISTS can_view TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS can_edit TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS can_delete TINYINT(1) NOT NULL DEFAULT 0;

-- -----------------------------------------------------------------
-- STEP 3 — copy every role's actual permission values across, matched
-- by (role_id, module_key). Safe to re-run — it would just re-copy
-- the same values again.
-- -----------------------------------------------------------------
UPDATE role_modules rm
JOIN role_permissions rp ON rp.role_id = rm.role_id AND rp.module_key = rm.module_key
SET rm.can_view = rp.can_view, rm.can_edit = rp.can_edit, rm.can_delete = rp.can_delete;

-- -----------------------------------------------------------------
-- STEP 4 — drop the now-redundant table. This is the point of no
-- return: only reached this line if Step 1 returned zero rows and
-- Step 3 has actually run above. Once this runs, role_permissions is
-- gone for good — its data now lives in role_modules instead.
-- -----------------------------------------------------------------
DROP TABLE IF EXISTS role_permissions;
