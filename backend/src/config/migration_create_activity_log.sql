-- =================================================================
-- Migration: create the `activity_log` table
-- =================================================================
-- Run this ONCE against your existing live database. schema.sql only
-- CREATEs tables that don't already exist, so it's actually safe to
-- just run `npm run migrate` again too — it would create this new
-- table without touching anything else. This standalone file does
-- the exact same thing, just without needing to re-run the whole
-- schema file.
--
-- HOW TO RUN:
--   mysql -u <your_user> -p salary_slip < migration_create_activity_log.sql
--   (replace `salary_slip` with your actual database name if different)
--
-- SAFE TO RE-RUN: uses "IF NOT EXISTS", so running this twice by
-- mistake does nothing the second time.
--
-- WHAT THIS DOES: adds one new table, `activity_log`, tracking staff
-- account actions only (Admin, HR, Super Admin, or any other account
-- managed via the Users page) — never Employee Master logins, which
-- can only ever view their own salary slip. Only real changes are
-- recorded (create/update/delete/import/status change/password
-- reset/login) — not page views, previews, or downloads. No existing
-- data anywhere else is touched.
-- =================================================================

CREATE TABLE IF NOT EXISTS activity_log (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  user_id      INT DEFAULT NULL,
  performed_by VARCHAR(60) NOT NULL,
  role_name    VARCHAR(40) NOT NULL,
  action       VARCHAR(20) NOT NULL,
  module_key   VARCHAR(40) DEFAULT NULL,
  description  VARCHAR(255) NOT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_activity_log_user (user_id),
  KEY idx_activity_log_created (created_at),
  CONSTRAINT fk_activity_log_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;
