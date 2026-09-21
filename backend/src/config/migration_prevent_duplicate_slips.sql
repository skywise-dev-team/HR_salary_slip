-- =================================================================
-- Migration: prevent duplicate salary_slips rows per salary record
-- =================================================================
-- Run this ONCE against your existing live database, in order, as one
-- script.
--
-- WHY: generateSlipForSalaryData() used to check "does a slip already
-- exist for this record?" and then decide insert-vs-update as two
-- separate steps, with nothing stopping two regenerate requests fired
-- at nearly the same moment (a double-click, two people acting on the
-- same missing slip, a slow connection prompting a repeat click) from
-- both passing that check and both inserting — creating two
-- salary_slips rows for the same salary_data_id. The application code
-- has been fixed to make this atomic (see slipService.js), but this
-- migration is also needed to add a real database-level guarantee
-- (not just an application-level one) and to clean up any duplicates
-- that may already exist from before that fix.
--
-- HOW TO RUN:
--   mysql -u <your_user> -p salary_slip < migration_prevent_duplicate_slips.sql
--   (replace `salary_slip` with your actual database name if different)
--
-- -----------------------------------------------------------------
-- STEP 1 — PREVIEW. Shows every salary_data_id that currently has more
-- than one salary_slips row. If this returns zero rows, you never hit
-- the bug — skip straight to Step 3.
-- -----------------------------------------------------------------
SELECT salary_data_id, COUNT(*) AS duplicate_count
FROM salary_slips
GROUP BY salary_data_id
HAVING COUNT(*) > 1;

-- -----------------------------------------------------------------
-- STEP 2 — CLEAN UP. For any salary_data_id with duplicates, keeps
-- only the most recently generated row (highest generated_at, ties
-- broken by highest id) and deletes the rest. Since the PDF filename
-- is always the same deterministic name for a given employee and
-- period, the file on disk is unaffected either way — this only
-- removes redundant database rows, never a file anyone still needs.
-- -----------------------------------------------------------------
DELETE ss1 FROM salary_slips ss1
JOIN salary_slips ss2
  ON ss1.salary_data_id = ss2.salary_data_id
  AND (ss1.generated_at < ss2.generated_at
       OR (ss1.generated_at = ss2.generated_at AND ss1.id < ss2.id));

-- -----------------------------------------------------------------
-- STEP 3 — add the constraint itself. Safe to re-run (IF NOT EXISTS).
-- This will fail with a duplicate-key error if Step 2 wasn't actually
-- run first and duplicates still exist — that's expected and means
-- Step 2 needs to run first.
-- -----------------------------------------------------------------
ALTER TABLE salary_slips
  ADD UNIQUE KEY IF NOT EXISTS uq_slip_salary_data (salary_data_id);
