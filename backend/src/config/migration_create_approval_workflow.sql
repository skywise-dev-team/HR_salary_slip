-- =================================================================
-- Migration: create the approval workflow tables
-- =================================================================
-- Run this ONCE against your existing live database.
--
-- HOW TO RUN:
--   mysql -u <your_user> -p salary_slip < migration_create_approval_workflow.sql
--   (replace `salary_slip` with your actual database name if different)
--
-- SAFE TO RE-RUN: uses "IF NOT EXISTS".
--
-- WHAT THIS DOES: adds two new tables, approval_requests and
-- notifications, for the staff-approval workflow in Employee Master,
-- Users, and Upload Salary Data. Purely additive — no existing table
-- or data is touched.
-- =================================================================

CREATE TABLE IF NOT EXISTS approval_requests (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  module_key          VARCHAR(40) NOT NULL,
  action              VARCHAR(20) NOT NULL,
  requested_by        INT DEFAULT NULL,
  requested_by_name   VARCHAR(60) NOT NULL,
  requested_by_email  VARCHAR(150),
  target_id           INT DEFAULT NULL,
  payload             JSON,
  staged_file_path    VARCHAR(255),
  description         VARCHAR(255) NOT NULL,
  status              ENUM('PENDING','APPROVED','REJECTED','EXPIRED') NOT NULL DEFAULT 'PENDING',
  rejection_reason    VARCHAR(500),
  decided_by          INT DEFAULT NULL,
  decided_by_name     VARCHAR(60),
  decided_at          TIMESTAMP NULL DEFAULT NULL,
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at          TIMESTAMP NOT NULL,
  KEY idx_approval_status (status),
  KEY idx_approval_requested_by (requested_by),
  CONSTRAINT fk_approval_requested_by FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_approval_decided_by FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notifications (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  user_id       INT NOT NULL,
  approval_id   INT DEFAULT NULL,
  message       VARCHAR(500) NOT NULL,
  is_read       TINYINT(1) NOT NULL DEFAULT 0,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_notif_user (user_id, is_read),
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_notif_approval FOREIGN KEY (approval_id) REFERENCES approval_requests(id) ON DELETE SET NULL
) ENGINE=InnoDB;
