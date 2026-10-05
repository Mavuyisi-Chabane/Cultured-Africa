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
5. `GET /health` returns `{"status":"ok"}` for your host's uptime checks.

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
