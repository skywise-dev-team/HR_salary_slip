-- =================================================================
-- Migration: add `regeneration_requested_at` to `salary_slips`
-- =================================================================
-- Run this ONCE against your existing live database.
--
-- HOW TO RUN:
--   mysql -u <your_user> -p salary_slip < migration_add_regeneration_requested_at.sql
--   (replace `salary_slip` with your actual database name if different)
--
-- SAFE TO RE-RUN: uses "IF NOT EXISTS".
--
-- WHAT THIS DOES: adds one column, letting an employee's request to
-- regenerate a missing slip (removed by the 12-month retention
-- cleanup) be tracked and surfaced to staff on the Upload Salary Data
-- page. No existing data is touched.
-- =================================================================

ALTER TABLE salary_slips
  ADD COLUMN IF NOT EXISTS regeneration_requested_at TIMESTAMP NULL DEFAULT NULL;
