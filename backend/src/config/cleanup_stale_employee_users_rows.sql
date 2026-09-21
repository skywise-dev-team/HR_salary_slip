-- =================================================================
-- Cleanup: remove stale `users` rows that shadow Employee Master
-- =================================================================
-- Run this ONCE against your existing live database, AFTER deploying
-- the auth.js fix that excludes these rows from login. That code fix
-- alone already makes these rows harmless (they can never be used to
-- log in anymore), but they're still just dead clutter sitting in
-- your `users` table — this removes them properly.
--
-- WHY THESE ROWS EXIST: before Employee Master had its own built-in
-- login system, employee logins were created directly in the `users`
-- table (same "Employee ID as both username and initial password"
-- convention Employee Master still uses today). Those old rows were
-- never automatically migrated or removed when Employee Master's own
-- login system was introduced, so any that were created before that
-- point are still sitting here — and because login checks the `users`
-- table before Employee Master, a stale row like this would actually
-- take priority over the real Employee Master login for that same ID,
-- silently granting an ordinary employee full unrestricted access
-- instead of their own self-service view.
--
-- STEP 1 — PREVIEW what will be deleted (run this first, look at the
-- results, and confirm every row shown is really a stale leftover you
-- don't need):
--
--   SELECT u.id, u.user_id, u.email, u.role_id
--   FROM users u
--   WHERE EXISTS (SELECT 1 FROM employees e WHERE e.employee_id = u.user_id)
--     AND u.user_id != 'admin';
--
-- STEP 2 — once you've confirmed the preview looks right, run the
-- actual delete below. The `admin` account is explicitly excluded as
-- an extra safety net (it should never coincidentally match an
-- Employee ID, but this guarantees it's never touched either way).
-- =================================================================

DELETE u FROM users u
WHERE EXISTS (SELECT 1 FROM employees e WHERE e.employee_id = u.user_id)
  AND u.user_id != 'admin';
