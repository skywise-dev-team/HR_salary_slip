const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const { SLIPS_DIR } = require('./slipService');

// Deletes only the generated PDF *file* for any salary slip whose pay
// period is more than 12 months old — never the underlying salary_data or
// salary_slips database rows, which are kept forever. The numbers stay
// fully intact either way; only the disk copy of the PDF goes away. If
// someone later needs a slip past this window, it can be regenerated
// on-demand from the (still-present) salary_data row — see
// generateSlipForSalaryData, and the new request/regenerate flow on the
// Salary Slips and Upload Salary Data pages.
//
// "12 months old" is measured by the pay period itself (period_month /
// period_year) — not by when it was uploaded or generated — matching how
// this was explicitly specified.
async function cleanupOldSlipFiles() {
  const cutoff = new Date();
  cutoff.setDate(1); // avoid month-length edge cases (e.g. running on the 31st)
  cutoff.setMonth(cutoff.getMonth() - 12);
  const cutoffKey = cutoff.getFullYear() * 100 + (cutoff.getMonth() + 1);

  const [rows] = await pool.query(
    `SELECT ss.id, ss.file_path, sd.period_month, sd.period_year
     FROM salary_slips ss
     JOIN salary_data sd ON sd.id = ss.salary_data_id
     WHERE ss.file_path IS NOT NULL
       AND (sd.period_year * 100 + sd.period_month) < ?`,
    [cutoffKey]
  );

  let deleted = 0;
  for (const row of rows) {
    const filePath = path.join(SLIPS_DIR, row.file_path);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        deleted++;
      } catch (err) {
        console.error(`Retention cleanup: failed to delete ${filePath}:`, err.message);
      }
    }
  }
  if (deleted) console.log(`Retention cleanup: removed ${deleted} salary slip file(s) older than 12 months (pay period basis).`);
  return deleted;
}

// Deletes activity_log rows older than 6 months, measured from when each
// entry was actually recorded (created_at).
async function cleanupOldActivityLogs() {
  const [result] = await pool.query(
    `DELETE FROM activity_log WHERE created_at < DATE_SUB(NOW(), INTERVAL 6 MONTH)`
  );
  if (result.affectedRows) console.log(`Retention cleanup: removed ${result.affectedRows} activity log entr(y/ies) older than 6 months.`);
  return result.affectedRows;
}

async function runRetentionCleanup() {
  try {
    await cleanupOldSlipFiles();
  } catch (err) {
    console.error('Retention cleanup (slip files) failed:', err.message);
  }
  try {
    await cleanupOldActivityLogs();
  } catch (err) {
    console.error('Retention cleanup (activity log) failed:', err.message);
  }
}

module.exports = { runRetentionCleanup, cleanupOldSlipFiles, cleanupOldActivityLogs };
