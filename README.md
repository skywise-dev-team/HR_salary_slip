# Salary Slip Register — Full Stack Application

React (Vite) frontend + Node.js/Express backend + MySQL database.

Folder structure (kept separate for independent deployment):

```
salary-slip-system/
├── backend/     Node.js + Express API, MySQL access, PDF/Excel generation
└── frontend/    React (Vite) single-page app
```

## 1. Database setup

1. Make sure MySQL is running and you have a user with permission to create databases.
2. From `backend/`, copy `.env.example` to `.env` and fill in your MySQL credentials:

   ```
   cp .env.example .env
   ```

3. Install dependencies and apply the schema:

   ```
   cd backend
   npm install
   npm run migrate     # creates the `salary_slip` database and all tables
   npm run seed         # creates the default admin login
   ```

   Default login after seeding: **user_id `admin`**, **password `Admin@123`**.
   Change this password immediately after first login (Change Password page).

## 2. Backend

```
cd backend
npm install
npm run dev      # nodemon, http://localhost:5000
# or
npm start        # plain node
```

Environment variables (`backend/.env`):

| Variable | Purpose |
|---|---|
| `PORT` | API port (default 5000) |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | MySQL connection |
| `JWT_SECRET` | Secret used to sign login tokens — set a long random string |
| `JWT_EXPIRES_IN` | Token lifetime, e.g. `8h` |
| `CORS_ORIGIN` | Comma-separated list of allowed frontend origins |

Uploaded files (establishment logos/signatures, Excel imports, generated PDF
salary slips) are stored under `backend/uploads/`. Back this folder up (or
point it at persistent storage) when you deploy.

## 3. Frontend

```
cd frontend
npm install
cp .env.example .env    # set VITE_API_BASE_URL to your backend URL
npm run dev              # http://localhost:5173
```

For production:

```
npm run build            # outputs static files to frontend/dist
```

Serve `frontend/dist` with any static host (Nginx, S3+CloudFront, etc.) and
point `VITE_API_BASE_URL` at your deployed backend.

## 4. Application modules

**Dashboard** — counts of establishments/employees/users and recent pay-period totals.

**Master**
- *Establishments* — company/unit records that print on salary slips (code, name, signatory, address, logo, signature).
- *Employee Master* — fixed details printed on every slip (Employee ID, name, relative's name & relation, designation, UAN, bank A/C, establishment, active-from date, Active/Inactive toggle). Changing an employee's establishment automatically logs the change in posting history.

**Upload Salary Data** — one row per employee per pay period; add manually or bulk-import via an Excel file (`employee_id, period_month, period_year, paid_days, basic, hra, other_allowance, pf_deduction, esi_deduction, pt_deduction, other_deduction`). Gross/total deductions/net pay are computed automatically.

**Salary Slips** — generate a PDF slip from any uploaded salary-data record, list/filter generated slips, preview inline, download, or delete them. The PDF matches the statutory Form-XVI wage slip layout on **A5 landscape** paper, pixel-checked against the original prototype template. Downloaded files (single or via the ZIP bulk-download button) are named `{Employee Name}_{Employee ID}_{Month-Year}.pdf`; a bulk ZIP download groups files into one folder per establishment. A user's `salary_slip_access` setting (View & Download / View Only / No Access) controls what they can do here — View Only users get the inline preview but not the download/ZIP buttons, enforced on the backend too, not just hidden in the UI.

**Change Password** — replaces the old Settings screen; lets the signed-in user change their own password.

**Admin**
- *Users* — Add User (User ID, password, optional email, salary slip access, role). List shows User ID, email, role, Active/Inactive toggle, and Edit/View/Delete actions.
- *Roles & Permissions* — Add Role (title, description, multi-select modules). List shows title, description, a **Manage Access** button opening a View/Create/Edit/Delete checkbox matrix per module, and Edit/View/Delete actions.

The seeded **Admin** role always has full access to every module regardless
of the `role_permissions` table, so you can't lock yourself out.

## 5. Notes on the schema

`backend/src/config/schema.sql` is derived from the schema you supplied, with
a few corrections so it actually runs on MySQL:

- Tables reordered so foreign keys resolve (`roles` → `users` → `establishments` → `employees` → `salary_data` → `salary_slips`).
- Fixed the `roles` seed insert (the original referenced a `name` column; the table defines `role_name`).
- `employee_post_hist.employee_id` now references `employees.id` (an INT), not the human-readable `employee_id` string, since the original had two UNIQUE `employee_id` columns pointing at different things.

## 6. Salary slip PDF format

The generated PDF follows the statutory **Form-XVI** wage slip layout (Occupational Safety, Health and Working Conditions Code, 2020) on **A5 landscape** paper (210mm × 148.5mm — the prototype's sheet is landscape, not portrait), using **Carlito** (the free, metrically-compatible open-source equivalent of Calibri, matching the prototype's font) via `backend/src/assets/fonts/Carlito-*.ttf` bundled with the project — needed both for visual match and because the ₹ symbol isn't in PDF's built-in fonts. The establishment's logo/signature (if uploaded) is embedded, and net pay is spelled out in words using the Indian numbering system (Lakh/Crore), matching the prototype's `amountWords()` output exactly. "Date of issue" uses the salary record's upload date, falling back to today only if that's missing.

**Field mapping caveat:** the statutory form has five earnings columns (Basic, D.A., HRA, Conveyance Allowance, Overtime) and five deduction columns (PF, ESI, PT, TDS, Others), but this schema only tracks `basic`, `hra`, one generic `other_allowance`, plus `pf_deduction`/`esi_deduction`/`pt_deduction`/one generic `other_deduction`. To keep the printed headings exactly matching the form:
- `other_allowance` is shown under **D.A.**
- `other_deduction` is shown under **Others**
- **Conveyance Allowance**, **Overtime**, and **TDS** always print as ₹0, since there's no dedicated column for them

If you need those tracked separately, `salary_data` would need dedicated columns for them (`da`, `conveyance_allowance`, `overtime`, `tds`) — that's a schema change I didn't make without asking first.

## 7. Downloads and bulk ZIP export

Single downloads and previews are named `{Employee Name}_{Employee ID}_{Month-Year}.pdf`. The **"Download all as ZIP"** button on the Salary Slips page (visible to `VIEW_DOWNLOAD` users when the current filter has results) bundles every matching, already-generated slip into one ZIP, with one folder per establishment inside it — useful when a filter spans multiple establishments.
