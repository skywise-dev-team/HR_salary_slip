const path = require('path');
const fs = require('fs');
const pool = require('../config/db');
const { generateSalarySlipPdf, formatDate } = require('./pdfGenerator');

const SLIPS_DIR = path.join(__dirname, '..', '..', 'uploads', 'slips');
const LOGOS_DIR = path.join(__dirname, '..', '..', 'uploads', 'logos');
const SIGNATURES_DIR = path.join(__dirname, '..', '..', 'uploads', 'signatures');
fs.mkdirSync(SLIPS_DIR, { recursive: true });

// Generates (or regenerates) the PDF for one salary_data row and keeps the
// salary_slips table in sync. Used both by the manual "regenerate" endpoint
// and automatically whenever salary data is uploaded (single entry or bulk
// Excel import) — slips no longer need a separate manual "Generate" action.
//
// `db` is an optional connection/transaction to run the queries on (e.g. the
// connection an Excel import is using for its transaction) — defaults to the
// shared pool for regular single-request use.
async function generateSlipForSalaryData(salaryDataId, db = pool) {
  const [[record]] = await db.query(
    `SELECT sd.*, e.employee_id AS emp_code, e.full_name, e.relative_name, e.designation,
            e.uan, e.bank_account_no, es.name AS establishment_name, es.address, es.signatory_name,
            es.logo_path, es.signature_path
     FROM salary_data sd
     JOIN employees e ON e.id = sd.employee_id
     JOIN establishments es ON es.id = sd.establishment_id
     WHERE sd.id = ?`,
    [salaryDataId]
  );
  if (!record) throw new Error(`Salary data record ${salaryDataId} not found`);

  record.logo_path = record.logo_path ? path.join(LOGOS_DIR, record.logo_path) : null;
  // Establishments that uploaded a signature before the upload-middleware fix
  // may have it sitting in uploads/logos/ instead of uploads/signatures/ —
  // fall back to check there so it still renders without a re-upload.
  if (record.signature_path) {
    const inSignatures = path.join(SIGNATURES_DIR, record.signature_path);
    const inLogos = path.join(LOGOS_DIR, record.signature_path);
    record.signature_path = fs.existsSync(inSignatures) ? inSignatures : (fs.existsSync(inLogos) ? inLogos : inSignatures);
  } else {
    record.signature_path = null;
  }
  // "Date of issue" is a fixed business date, not a record of any technical
  // processing timestamp — always the 7th of the month immediately
  // following the pay period, regardless of when the salary data was
  // actually uploaded or the slip (re)generated. A December period rolls
  // into January of the following year (e.g. December 2025 -> 07-01-2026).
  const issueMonth = record.period_month === 12 ? 1 : record.period_month + 1;
  const issueYear = record.period_month === 12 ? record.period_year + 1 : record.period_year;
  record.issueDate = formatDate(new Date(issueYear, issueMonth - 1, 7));

  const filename = `slip_${record.emp_code}_${record.period_month}_${record.period_year}.pdf`;
  const outPath = path.join(SLIPS_DIR, filename);
  await generateSalarySlipPdf(record, outPath);

  // Used only to report whether this was a fresh generation or a
  // regeneration in the return value below — it has no bearing on data
  // correctness even if two regenerate requests race here (a double-click,
  // two people acting on the same missing slip at once). The actual write
  // is atomic via ON DUPLICATE KEY UPDATE, backed by a unique constraint on
  // salary_data_id, so the database itself guarantees at most one row ever
  // exists per salary record — at worst a race here mislabels one response
  // as "generated" instead of "regenerated", never a duplicate row.
  const [[existingBefore]] = await db.query('SELECT id FROM salary_slips WHERE salary_data_id = ?', [record.id]);

  await db.query(
    `INSERT INTO salary_slips (salary_data_id, file_path)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE file_path = VALUES(file_path), generated_at = CURRENT_TIMESTAMP`,
    [record.id, filename]
  );
  const [[slip]] = await db.query('SELECT id FROM salary_slips WHERE salary_data_id = ?', [record.id]);

  return { id: slip.id, file_path: filename, regenerated: !!existingBefore };
}

module.exports = { generateSlipForSalaryData, SLIPS_DIR, LOGOS_DIR, SIGNATURES_DIR };
