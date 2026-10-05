# Cultured Africa — Streaming Platform

A Node.js / Express web app (EJS views, SQLite database) for streaming and purchasing
African cultural films, with a customer site and an admin portal.

## Requirements

- **Node.js 22.5 or newer** (the app uses the built-in `node:sqlite` module — no separate
  database server is needed). Check with `node --version`.
- Google Chrome or Microsoft Edge installed (only needed for exporting admin reports as PDF).

## Running the app

```bash
npm install
npm start
```

Then open <http://localhost:3000>.

On first start the app creates `db/cultured-africa.sqlite` and fills it with demo data
automatically. To reset to a clean demo state, stop the server, delete that file, and start again.

## Automated tests

```bash
npm test
```

Runs about 70 checks of the main flows in roughly 20 seconds: registration and email
verification, login, Remember me, password reset, consent, the Account page, buying with
Paystack, receipts, the 6-month access period, 18+ confirmation, one device at a time,
reviews, search, Continue watching, the admin portal (customers, cultures, films,
feedback), Help and Contact, emails, security (CSRF, headers, protected streaming), dates
and backups. Each test file starts its own copy of the app on a temporary database with
demo data and a fake Paystack, so it never touches your real database, inbox or payments.
Run it before every commit and before deploying; all tests should pass.

## Styles (CSS)

Page styles come from `public/css/app.css`, built by Tailwind from the classes used in
`views/`. After adding or changing classes in a view, rebuild it and commit the result:

```bash
npm run build:css     # once
npm run watch:css     # or: rebuild automatically while editing
```

The theme (brand colours, fonts, animations) is in `tailwind.config.js`; accessibility
styles (keyboard focus outline, reduced motion) are in `src/styles.css`.

## Demo logins

| Role | Where | Email | Password |
|------|-------|-------|----------|
| Customer | `/login` | `member@culturedafrica.co.za` | `member123` |
| Customer | `/login` | `thabo.nkosi@example.com` (and other demo viewers) | `demo1234` |
| Super admin | `/admin/login` | `admin@culturedafrica.co.za` | `admin123` |

## Optional configuration (`.env`)

The app runs without any configuration. To enable extra features, copy `.env.example`
to `.env` and fill in the values:

- **Paystack test keys**: turn on film purchases (sandbox payments).
- **SMTP settings**: send real verification and password-reset emails. When these are left
  blank, emails are saved as files in `db/dev-inbox/` instead, so the registration and
  password-reset flows still work. Open the file for your address to get the code or link.

## Deploying to production

1. Set `NODE_ENV=production` and a random `SESSION_SECRET` of at least 32 characters
   (the app will not start without one). Set `APP_BASE_URL` to the site's real address so
   links in emails work. See `.env.example` for every setting.
2. Point `DB_PATH` and `UPLOADS_DIR` at persistent storage.
3. No demo accounts are created in production. Create the first super admin on the server:

   ```bash
   npm run create-admin
   ```

   Further admins can then be invited from **Manage Admins** in the admin portal.
4. HTTPS is required for "Add to Home screen" (the service worker in `public/pwa/sw.js`)
   to work on phones.
5. Daily database backups run automatically in production. Set `BACKUP_DIR` on the
   persistent disk (e.g. `/var/data/backups`); the newest 14 are kept (`BACKUP_KEEP`).
   Take one by hand with `npm run backup`. Backups on the same disk don't survive losing
   that disk, so download a copy regularly (or use the host's disk snapshots).
   **To restore:** stop the app, copy a backup over the database file (`DB_PATH`), delete
   any `-wal`/`-shm` files next to it, and start the app.
6. `GET /health` returns `{"status":"ok"}` for your host's uptime checks.

Full films are only ever served through `/film/:id/stream` to logged-in customers who own
them; `/uploads` serves thumbnails and trailers only.

## Project structure

```
server.js          App entry point
config/            Paystack and email configuration
db/                Schema, seed data and database connection
middleware/        Auth, rate limiting, file uploads
routes/            Customer, account, film, notification and admin routes
services/          Email sending
utils/             Helpers (passwords, verification codes, report thresholds, PDF export)
views/             EJS page templates and partials
public/uploads/    Films and thumbnails uploaded through the admin portal
screen_layout/     Screenshots of the main screens
```
