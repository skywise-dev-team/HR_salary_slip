-- =================================================================
-- Migration: approval routing (specific approvers per module/action)
-- =================================================================
-- Run this ONCE against your existing live database.
--
--   mysql -u <your_user> -p salary_slip < migration_add_approval_routing.sql
--
-- SAFE TO RE-RUN: uses "IF NOT EXISTS" / "ADD COLUMN IF NOT EXISTS".
--
-- WHAT THIS DOES: adds a can_approve flag to users, a visible_to column to
-- approval_requests (tracks which specific accounts a routed request is
-- restricted to), and one new table (approval_routing_rules, holding each
-- rule's own approver list directly as a JSON column rather than a
-- separate join table). Purely additive — no existing data is touched.
-- After running this, the one protected admin account automatically has
-- can_approve set to 1 — everyone else defaults to 0 until you turn it on
-- for them from the Users page.
-- =================================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS can_approve TINYINT(1) NOT NULL DEFAULT 0;

UPDATE users SET can_approve = 1 WHERE user_id = 'admin';

ALTER TABLE approval_requests
  ADD COLUMN IF NOT EXISTS visible_to JSON DEFAULT NULL;

CREATE TABLE IF NOT EXISTS approval_routing_rules (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  module_key    VARCHAR(40) DEFAULT NULL,
  action        VARCHAR(20) DEFAULT NULL,
  approver_ids  JSON NOT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
