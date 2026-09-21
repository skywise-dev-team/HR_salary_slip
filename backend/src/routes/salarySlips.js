const express = require('express');
const asyncRouter = require('../utils/asyncRouter');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const pool = require('../config/db');
const { requireAuth, requirePermission, requireNotPendingPasswordChange } = require('../middleware/auth');
const { generateSlipForSalaryData, SLIPS_DIR } = require('../utils/slipService');
const { logActivity } = require('../utils/activityLog');

const router = asyncRouter();
router.use(requireAuth);
router.use(requireNotPendingPasswordChange);

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

// Strips characters that are unsafe in file/folder names on Windows/macOS/Linux.
const sanitizeName = (str) => String(str || '').replace(/[\\/:*?"<>|]/g, '').trim();

// "Md Irfan Ansari_1527515_June-2026.pdf" — employee name, employee ID, period.
function slipDownloadName(fullName, empCode, month, year) {
  return `${sanitizeName(fullName)}_${sanitizeName(empCode)}_${MONTHS[month]}-${year}.pdf`;
}

const LIST_SQL = `
  SELECT ss.*, sd.establishment_id, sd.period_month, sd.period_year, sd.net_pay,
         e.employee_id AS emp_code, e.full_name, es.name AS establishment_name
  FROM salary_slips ss
  JOIN salary_data sd ON sd.id = ss.salary_data_id
  JOIN employees e ON e.id = sd.employee_id
  JOIN establishments es ON es.id = sd.establishment_id`;

function buildFilters(query) {
  const { establishment_id, month, year, search } = query;
  const clauses = [];
  const params = [];
  if (establishment_id) { clauses.push('sd.establishment_id = ?'); params.push(establishment_id); }
  if (month) { clauses.push('sd.period_month = ?'); params.push(month); }
  if (year) { clauses.push('sd.period_year = ?'); params.push(year); }
  if (search) { clauses.push('(e.employee_id LIKE ? OR e.full_name LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

// Resolves the "restrict to own records" id for this request, or null for
// no restriction. An Employee Master-provisioned login (source: 'employee')
// is always restricted to its own record — we already know its employees.id
// directly from the authenticated session (see middleware/auth.js), so no
// lookup is needed. A users-table login (Admin/HR/any manually-created
// staff account) is never an end-user employee login under this design, so
// it always gets full visibility, governed purely by its role's
// salary_slips permission via the requirePermission middleware already
// applied to every route below.
function resolveOwnEmployeeId(req) {
  return req.user.source === 'employee' ? req.user.id : null;
}

// Appends "sd.employee_id = ?" to an existing WHERE clause (or creates one),
// only when ownEmployeeId is set. Used by every endpoint below that lists or
// bulk-serves slips, so an employee login's results are always additionally
// scoped to their own records on top of whatever other filters were applied.
function restrictToOwn(where, params, ownEmployeeId) {
  if (!ownEmployeeId) return { where, params };
  return {
    where: where ? `${where} AND sd.employee_id = ?` : 'WHERE sd.employee_id = ?',
    params: [...params, ownEmployeeId]
  };
}

router.get('/', requirePermission('salary_slips', 'view'), async (req, res) => {
  const filtered = buildFilters(req.query);
  const ownEmployeeId = resolveOwnEmployeeId(req);
  const { where, params } = restrictToOwn(filtered.where, filtered.params, ownEmployeeId);
  const [rows] = await pool.query(`${LIST_SQL} ${where} ORDER BY ss.generated_at DESC`, params);
  // Computed per row, not stored — reflects whether the PDF actually exists
  // on disk right now (it may have been removed by the 12-month retention
  // cleanup). Lets the frontend offer "Request regeneration" in place of a
  // Preview/Download that would otherwise just 404.
  const withFileStatus = rows.map((r) => ({ ...r, file_exists: !!r.file_path && fs.existsSync(path.join(SLIPS_DIR, r.file_path)) }));
  res.json(withFileStatus);
});

// Employee self-service: requests that staff regenerate a slip whose PDF
// file is missing (most commonly because the 12-month retention cleanup
// removed it). Employees only ever have view-level access to salary_slips
// (see the shared "Employee" role in middleware/auth.js), so this is
// deliberately separate from the staff-only /generate endpoint below — it
// only ever records a request, never performs the regeneration itself.
router.post('/:id/request-regeneration', requirePermission('salary_slips', 'view'), async (req, res) => {
  if (req.user.source !== 'employee') {
    return res.status(403).json({ message: 'This action is only available to employee self-service logins.' });
  }
  const [[slip]] = await pool.query(
    `SELECT ss.id, ss.file_path, ss.regeneration_requested_at, sd.employee_id AS sd_employee_id
     FROM salary_slips ss JOIN salary_data sd ON sd.id = ss.salary_data_id
     WHERE ss.id = ?`,
    [req.params.id]
  );
  if (!slip) return res.status(404).json({ message: 'Salary slip not found' });
  if (slip.sd_employee_id !== req.user.id) {
    return res.status(403).json({ message: 'You can only request regeneration of your own salary slips' });
  }
  if (slip.file_path && fs.existsSync(path.join(SLIPS_DIR, slip.file_path))) {
    return res.status(400).json({ message: 'This salary slip file already exists — no need to request regeneration.' });
  }
  if (slip.regeneration_requested_at) {
    return res.status(200).json({ message: 'Already requested — staff will regenerate it shortly.' });
  }

  await pool.query('UPDATE salary_slips SET regeneration_requested_at = NOW() WHERE id = ?', [slip.id]);
  res.json({ message: 'Request sent — staff will regenerate your slip shortly.' });
});

// Manual regenerate — kept for fixing a slip after editing salary data or
// establishment details (logo/signature/address). Slips are otherwise
// created automatically when salary data is uploaded; there is no manual
// "Generate" action in the UI anymore.
router.post('/generate/:salaryDataId', requirePermission('salary_slips', 'edit'), async (req, res) => {
  try {
    const result = await generateSlipForSalaryData(req.params.salaryDataId);
    await pool.query('UPDATE salary_slips SET regeneration_requested_at = NULL WHERE id = ?', [result.id]);
    res.status(result.regenerated ? 200 : 201).json({
      ...result,
      message: result.regenerated ? 'Salary slip regenerated' : 'Salary slip generated'
    });
    await logActivity(req, 'UPDATE', 'salary_slips', `${result.regenerated ? 'Regenerated' : 'Generated'} salary slip for salary data ID ${req.params.salaryDataId}`);
  } catch (err) {
    res.status(404).json({ message: err.message });
  }
});

// Inline preview — for anyone with salary_slips view access, except NO_ACCESS.
// Used to embed the PDF in the page when a row is selected.
router.get('/:id/preview', requirePermission('salary_slips', 'view'), async (req, res) => {
  if (req.user.salarySlipAccess === 'NO_ACCESS') {
    return res.status(403).json({ message: 'You do not have access to salary slips' });
  }
  const [[slip]] = await pool.query(
    `SELECT ss.*, sd.employee_id AS sd_employee_id
     FROM salary_slips ss
     JOIN salary_data sd ON sd.id = ss.salary_data_id
     WHERE ss.id = ?`,
    [req.params.id]
  );
  if (!slip) return res.status(404).json({ message: 'Salary slip not found' });

  const ownEmployeeId = resolveOwnEmployeeId(req);
  if (ownEmployeeId && slip.sd_employee_id !== ownEmployeeId) {
    return res.status(403).json({ message: 'You can only view your own salary slips' });
  }

  const filePath = path.join(SLIPS_DIR, slip.file_path);
  if (!fs.existsSync(filePath)) return res.status(404).json({ message: 'File missing on server' });

  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Content-Type', 'application/pdf');
  res.sendFile(filePath);
});

// Actual file download — only for users whose salary_slip_access is VIEW_DOWNLOAD.
// VIEW_ONLY users are limited to the inline preview above.
// Downloaded filename is Employee Name_Employee ID_Month-Year.pdf.
router.get('/:id/download', requirePermission('salary_slips', 'view'), async (req, res) => {
  if (req.user.salarySlipAccess !== 'VIEW_DOWNLOAD') {
    return res.status(403).json({ message: 'Your account is not permitted to download salary slips' });
  }
  const [[slip]] = await pool.query(
    `SELECT ss.*, sd.period_month, sd.period_year, sd.employee_id AS sd_employee_id,
            e.employee_id AS emp_code, e.full_name
     FROM salary_slips ss
     JOIN salary_data sd ON sd.id = ss.salary_data_id
     JOIN employees e ON e.id = sd.employee_id
     WHERE ss.id = ?`,
    [req.params.id]
  );
  if (!slip) return res.status(404).json({ message: 'Salary slip not found' });

  const ownEmployeeId = resolveOwnEmployeeId(req);
  if (ownEmployeeId && slip.sd_employee_id !== ownEmployeeId) {
    return res.status(403).json({ message: 'You can only download your own salary slips' });
  }

  const filePath = path.join(SLIPS_DIR, slip.file_path);
  if (!fs.existsSync(filePath)) return res.status(404).json({ message: 'File missing on server' });

  const downloadName = slipDownloadName(slip.full_name, slip.emp_code, slip.period_month, slip.period_year);
  res.download(filePath, downloadName);

  // Backend-only tracking, never exposed to the frontend — only counts as
  // "the employee downloaded it" when the download is actually performed by
  // the employee's own self-service login, not an Admin/HR download on
  // their behalf. Stays 1 no matter how many further times they download
  // it; automatically reset to 0 elsewhere whenever this record is edited.
  if (req.user.source === 'employee') {
    pool.query('UPDATE salary_data SET downloaded = 1 WHERE id = ?', [slip.salary_data_id])
      .catch((err) => console.error('Failed to set salary_data.downloaded flag:', err.message));
  }
});

// Bulk ZIP download organized into one folder per establishment inside the
// archive: {Establishment Name}/{Employee Name}_{Employee ID}_{Month-Year}.pdf
// Pass ?ids=1,2,3 (salary_slips.id values) to download an exact selection —
// e.g. from checkboxes in the UI — otherwise falls back to the same
// establishment/month/year/search filters used by the list view.
// Same VIEW_DOWNLOAD-only restriction as the single-file download.
router.get('/bulk-download', requirePermission('salary_slips', 'view'), async (req, res) => {
  if (req.user.salarySlipAccess !== 'VIEW_DOWNLOAD') {
    return res.status(403).json({ message: 'Your account is not permitted to download salary slips' });
  }

  const ownEmployeeId = resolveOwnEmployeeId(req);

  let rows;
  if (req.query.ids) {
    const ids = String(req.query.ids).split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);
    if (!ids.length) return res.status(400).json({ message: 'No valid slip ids provided' });
    const placeholders = ids.map(() => '?').join(',');
    const { where, params } = restrictToOwn(`WHERE ss.id IN (${placeholders})`, ids, ownEmployeeId);
    [rows] = await pool.query(`${LIST_SQL} ${where} ORDER BY es.name, e.full_name`, params);
  } else {
    const filtered = buildFilters(req.query);
    const { where, params } = restrictToOwn(filtered.where, filtered.params, ownEmployeeId);
    [rows] = await pool.query(`${LIST_SQL} ${where} ORDER BY es.name, e.full_name`, params);
  }

  const existingRows = rows.filter((r) => fs.existsSync(path.join(SLIPS_DIR, r.file_path)));
  if (!existingRows.length) {
    return res.status(404).json({ message: 'No salary slip files found for this selection' });
  }

  const { month, year, establishment_id } = req.query;
  const zipNameParts = ['salary-slips'];
  if (establishment_id) {
    const matchingRow = existingRows.find((r) => String(r.establishment_id) === String(establishment_id));
    if (matchingRow) zipNameParts.push(sanitizeName(matchingRow.establishment_name));
  }
  if (month && year) zipNameParts.push(`${MONTHS[month]}-${year}`);
  else if (year) zipNameParts.push(String(year));
  const zipFilename = `${zipNameParts.join('_')}.zip`;

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => { throw err; });
  archive.pipe(res);

  for (const row of existingRows) {
    const filePath = path.join(SLIPS_DIR, row.file_path);
    const folder = sanitizeName(row.establishment_name) || 'Establishment';
    const entryName = slipDownloadName(row.full_name, row.emp_code, row.period_month, row.period_year);
    archive.file(filePath, { name: `${folder}/${entryName}` });
  }

  await archive.finalize();

  // Backend-only tracking, never exposed to the frontend — see the note on
  // the single-file download route above for the exact rule.
  if (req.user.source === 'employee') {
    const salaryDataIds = existingRows.map((r) => r.salary_data_id);
    const placeholders2 = salaryDataIds.map(() => '?').join(',');
    pool.query(`UPDATE salary_data SET downloaded = 1 WHERE id IN (${placeholders2})`, salaryDataIds)
      .catch((err) => console.error('Failed to set salary_data.downloaded flag:', err.message));
  }
});

// Bulk delete — accepts { ids: [1,2,3] } in the request body. Must be
// registered before DELETE /:id so "bulk" is never captured as an :id.
router.delete('/bulk', requirePermission('salary_slips', 'delete'), async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
  if (!ids.length) return res.status(400).json({ message: 'No valid slip ids provided' });

  const placeholders = ids.map(() => '?').join(',');
  const [slips] = await pool.query(`SELECT * FROM salary_slips WHERE id IN (${placeholders})`, ids);
  slips.forEach((slip) => fs.unlink(path.join(SLIPS_DIR, slip.file_path), () => {}));
  await pool.query(`DELETE FROM salary_slips WHERE id IN (${placeholders})`, ids);
  res.json({ message: `${slips.length} salary slip(s) deleted`, deleted: slips.length });
  if (slips.length) await logActivity(req, 'DELETE', 'salary_slips', `Bulk deleted ${slips.length} salary slip(s)`);
});

router.delete('/:id', requirePermission('salary_slips', 'delete'), async (req, res) => {
  const [[slip]] = await pool.query('SELECT * FROM salary_slips WHERE id = ?', [req.params.id]);
  if (slip) fs.unlink(path.join(SLIPS_DIR, slip.file_path), () => {});
  await pool.query('DELETE FROM salary_slips WHERE id = ?', [req.params.id]);
  res.json({ message: 'Salary slip deleted' });
  await logActivity(req, 'DELETE', 'salary_slips', `Deleted salary slip ID ${req.params.id}`);
});

module.exports = router;
