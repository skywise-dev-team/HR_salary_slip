# Approval workflow — email configuration

Add these to your real `backend/.env` file (never committed/shared — this
file is just documentation of what's needed and what each value means).

## Required for approval emails to actually send

SMTP_HOST=                  # e.g. mail.yourcompany.com
SMTP_PORT=587                # 587 for STARTTLS (most common), 465 for SSL
SMTP_SECURE=false            # true only if using port 465
SMTP_USER=                  # the mailbox/account that authenticates to the server
SMTP_PASS=                  # its password — for Gmail/Outlook this MUST be an
                              # App Password, not the normal account password

## Optional

SMTP_FROM_NAME=Salary Slip Register   # display name fallback when a specific
                                       # requester's email can't be used as From
SMTP_ALLOW_ARBITRARY_FROM=true        # set to false if your mail server rejects
                                       # or rewrites a From address that isn't
                                       # the authenticated SMTP_USER account —
                                       # see the comment in utils/mailer.js
APP_BASE_URL=http://localhost:5173    # your frontend's real URL — used to build
                                       # the "review this request" link in emails

## If SMTP_HOST is left blank

Nothing crashes — the app logs "Email not sent — SMTP is not configured" to
the server console and continues normally. In-app notifications still work
even with no email configuration at all.

## Switching providers later

Nothing else in the code needs to change to switch from a company mail
server to Gmail, Outlook, or any other standard SMTP provider — only the
values above. For Gmail or Outlook specifically, SMTP_PASS must be an App
Password (generated from that account's security settings, after enabling
2-Step Verification) — a normal login password will be rejected by both.
