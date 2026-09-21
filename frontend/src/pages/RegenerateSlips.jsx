import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import SearchAutocomplete from '../components/SearchAutocomplete.jsx';
import api from '../api/axios.js';
import { useToast } from '../context/ToastContext.jsx';
import { formatINR } from '../utils/formatCurrency.js';
import { showResultToast } from '../utils/approvalToast.js';

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export default function RegenerateSlips() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [rows, setRows] = useState([]);
  const [expanded, setExpanded] = useState(() => new Set());
  const [groupSearch, setGroupSearch] = useState({});

  // Only ever the slips actually missing on disk — never the full employee
  // list. The backend already filters this server-side (checking each
  // file's real existence), so nothing here needs to re-filter anything.
  const load = () => {
    api.get('/api/salary-data/needs-regeneration').then(({ data }) => setRows(data));
  };
  useEffect(load, []);

  // Grouped by establishment + period. The backend already sorts by latest
  // period first, so building groups in first-seen order keeps that
  // ordering without needing to re-sort here.
  const groups = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      const key = `${r.establishment_id}-${r.period_month}-${r.period_year}`;
      if (!map.has(key)) {
        map.set(key, {
          key, establishment_id: r.establishment_id, establishment_name: r.establishment_name,
          period_month: r.period_month, period_year: r.period_year, employees: []
        });
      }
      map.get(key).employees.push(r);
    }
    return Array.from(map.values());
  }, [rows]);

  const toggleGroup = (key) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const regenerate = async (row) => {
    try {
      const { data } = await api.post(`/api/salary-data/${row.salary_data_id}/regenerate`);
      showToast(data.message || 'Regenerated successfully!');
      load();
    } catch (err) {
      showToast(err.response?.data?.message || 'Regeneration failed', 'error');
    }
  };

  const removeRecord = async (row) => {
    if (!confirm(`Delete the salary record and slip for ${row.full_name} (${row.emp_code}) — ${MONTHS[row.period_month]} ${row.period_year}? This cannot be undone.`)) return;
    try {
      const res = await api.delete(`/api/salary-data/${row.salary_data_id}`);
      showResultToast(showToast, res, 'Deleted successfully!');
      load();
    } catch (err) {
      showToast(err.response?.data?.message || 'Delete failed', 'error');
    }
  };

  return (
    <Layout>
      <div className="page-header">
        <div>
          <h1 className="page-title">Regenerate slips</h1>
        </div>
        <button className="btn btn-outline" onClick={() => navigate('/upload-salary')}>Back to Upload Salary Data</button>
      </div>

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 24 }}></th>
              <th>Establishment</th><th>Period</th><th>Missing slips</th>
            </tr>
          </thead>
          <tbody>
            {groups.flatMap((g) => {
              const isOpen = expanded.has(g.key);
              const search = (groupSearch[g.key] || '').trim().toLowerCase();
              const visibleEmployees = search
                ? g.employees.filter((r) => r.full_name.toLowerCase().includes(search) || r.emp_code.toLowerCase().includes(search))
                : g.employees;

              const groupRows = [
                <tr key={g.key} onClick={() => toggleGroup(g.key)} style={{ cursor: 'pointer' }}>
                  <td>{isOpen ? '▾' : '▸'}</td>
                  <td className="nowrap">{g.establishment_name}</td>
                  <td>{MONTHS[g.period_month]} {g.period_year}</td>
                  <td>{g.employees.length}</td>
                </tr>
              ];
              if (isOpen) {
                groupRows.push(
                  <tr key={`${g.key}-detail`}>
                    <td colSpan={4} style={{ padding: 0 }}>
                      <div style={{ padding: '8px 16px 16px 40px', background: 'var(--bg)' }}>
                        <SearchAutocomplete
                          placeholder="Employee name or ID"
                          value={groupSearch[g.key] || ''}
                          onChange={(v) => setGroupSearch({ ...groupSearch, [g.key]: v })}
                          options={g.employees}
                          getLabel={(r) => `${r.full_name} (${r.emp_code})`}
                          getValue={(r) => r.emp_code}
                          getKey={(r) => r.slip_id}
                        />
                        <table className="table" style={{ marginTop: 10 }}>
                          <thead>
                            <tr>
                              <th>Employee</th><th>Net pay</th><th>Requested by employee</th><th>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {visibleEmployees.map((r) => (
                              <tr key={r.slip_id}>
                                <td>{r.full_name} <span className="muted small">({r.emp_code})</span></td>
                                <td>{formatINR(r.net_pay)}</td>
                                <td>{r.regeneration_requested_at ? new Date(r.regeneration_requested_at).toLocaleString() : <span className="muted">No</span>}</td>
                                <td>
                                  <button className="link-btn" onClick={() => regenerate(r)}>Regenerate</button>
                                  <button className="link-btn danger" onClick={() => removeRecord(r)}>Delete</button>
                                </td>
                              </tr>
                            ))}
                            {!visibleEmployees.length && (
                              <tr><td colSpan={4} className="muted">No matching employees.</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                );
              }
              return groupRows;
            })}
            {!groups.length && <tr><td colSpan={4} className="muted">Nothing needs regeneration right now.</td></tr>}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}
