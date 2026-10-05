# Deploying Cultured Africa

How to put the website live on [Render](https://render.com), connect the domain, email and
Paystack, and look after it afterwards. Follow the sections in order the first time.

Everything can still be changed after launch: pushing to the `main` branch on GitHub
redeploys the site automatically, and customers' accounts, purchases and uploaded films are
kept on the persistent disk.

---

## 0. Before you start

You need, **in Cultured Africa's name** (so nothing has to be transferred later):

| Account | Used for | Who sets it up |
|---|---|---|
| GitHub access to this repository | Render deploys from it | Group 2 (add Cultured Africa as an owner at handover) |
| Render | Hosting | Cultured Africa (card for billing), with Group 2 invited as members |
| Domain, e.g. `culturedafrica.co.za` | The web address | Cultured Africa (via their domain registrar) |
| Paystack business account (verified) | Live payments and payouts | Cultured Africa |
| Email sending service | Verification codes, receipts, password resets | Cultured Africa (see step 4) |

Check before every deploy:

```bash
cd webapp
npm test        # all tests must pass
```

**Cost guide** (check current prices on each provider's site before quoting the client):
Render Starter instance plus a 20 GB disk, roughly USD 12 a month; domain around R100–R200 a
year; an email service has free tiers for low volumes; Paystack charges a fee per payment.

---

## 1. Create the service on Render

1. Sign in to Render with the Cultured Africa account and connect GitHub.
2. **New → Blueprint**, choose this repository. Render reads `render.yaml` (in the
   repository root) and proposes a web service called `cultured-africa` with a 20 GB disk.
3. Render asks for the values that aren't stored in Git. For now enter:
   - `APP_BASE_URL`: the address Render gives the service, e.g.
     `https://cultured-africa.onrender.com` (change it to the real domain in step 3)
   - Paystack keys: the **test** keys for now (step 5 switches to live)
   - SMTP settings: leave empty for now (step 4)
   - `BUSINESS_REG_NO`, `BUSINESS_VAT_NO`: leave empty until Cultured Africa provides them
4. **Apply**. The first deploy takes a few minutes. When it shows "Live", open
   `https://<your-service>.onrender.com/health`. It should show `{"status":"ok"}`.

What `render.yaml` already sets: Node 24, production mode, a random `SESSION_SECRET`, the
database, uploads and backups on the disk (`/var/data`), health checks, and auto-deploy.

> The site starts with an **empty** database: no films, no customers, no demo accounts.

## 2. Create the first admin

1. In Render, open the service → **Shell**.
2. Run:
   ```bash
   npm run create-admin
   ```
   and enter the owner's name, email and a strong password. This creates the super admin.
3. Log in at `/admin/login`. Other admins can then be invited from **Manage Admins**.
4. Add the cultures (**Cultures**), then upload the films (**Upload Film**).

**Large videos:** uploading a multi-gigabyte file through the browser is slow and can fail on
a weak connection. Compress films first (aim for under 2 GB for a short film; HandBrake's
"Fast 1080p30" preset works well) and upload from a fast, stable connection. Try a trailer
first.

## 3. Connect the domain

1. Render → service → **Settings → Custom Domains → Add**, e.g. `culturedafrica.co.za` and
   `www.culturedafrica.co.za`.
2. Render shows the DNS records to add. Add them at the domain registrar (usually a
   `CNAME` for `www` and an `A`/`ALIAS` record for the bare domain).
3. Wait until Render shows the domain as verified with a certificate (HTTPS is automatic).
4. Change `APP_BASE_URL` (Render → **Environment**) to `https://culturedafrica.co.za` and save.
   Render restarts the site. Emailed links and the home-screen app now use the domain.

## 4. Email

Verification codes, password resets, receipts and the newsletter are sent through an SMTP
email service. Use a transactional email service, or the SMTP server of the company's own
mailbox provider. Most have a free tier that covers a small shop.

1. Create the account and **verify the domain** `culturedafrica.co.za` in it. It gives you DNS
   records (SPF, DKIM and usually DMARC) to add at the registrar. Without these, emails go to
   spam.
2. Get the SMTP details and set them in Render → **Environment**:
   `SMTP_HOST`, `SMTP_PORT` (usually 587), `SMTP_USER`, `SMTP_PASS`, and
   `MAIL_FROM` = `Cultured Africa <no-reply@culturedafrica.co.za>`.
3. Test: use **Forgot Password?** with your own account, then register a test account.
   Check the emails arrive (not in spam) in Gmail and Outlook and look right on a phone.

## 5. Paystack (live payments)

1. In the Paystack dashboard: **Settings → API Keys & Webhooks**.
2. Set the **Live Webhook URL** to `https://culturedafrica.co.za/paystack/webhook`.
   (Set the Test Webhook URL to the same address while testing with test keys.)
   This makes sure a customer who pays always gets their film, even if their browser
   closes before returning to the site.
3. In Render → **Environment**, replace the test keys with the **live**
   `PAYSTACK_PUBLIC_KEY` and `PAYSTACK_SECRET_KEY`.
4. Test with a real card on a cheap film. Check the film unlocks, the receipt email
   arrives and the payment shows in Paystack. Then refund it from the Paystack dashboard.

Never put the secret key anywhere except Render's Environment settings.

## 6. Go-live checklist

- [ ] `npm test` passes on the code being deployed
- [ ] `/health` shows `{"status":"ok"}` on the real domain, with the padlock (HTTPS)
- [ ] No demo data (`SEED_DEMO_DATA` is not set in Render)
- [ ] First super admin created; cultures and films uploaded, each with an age rating and genre
- [ ] Emails arrive (registration code, password reset, receipt, newsletter, Contact form)
- [ ] One live purchase tested and refunded; the webhook URL is set
- [ ] Policy and Privacy pages show Cultured Africa's approved wording and company details
- [ ] Tested on an Android phone and an iPhone, including **Add to Home Screen**
- [ ] Uptime monitoring set up (below)
- [ ] First backup downloaded and stored safely (below)

---

## Looking after the site

### Updates
Make changes on a branch, run `npm test`, then merge to `main`. Render redeploys
automatically (a few seconds of downtime while it restarts). If something goes wrong,
Render → **Events** lets you roll back to the previous deploy with one click.

If you change any CSS classes in `views/`, run `npm run build:css` and commit
`public/css/app.css` too.

### Backups
- The site backs up the database **every day** and keeps the newest 14 on the disk.
- Those copies are on the same disk as the site, so they don't protect against losing the
  disk. **At least once a week**, a super admin should open **Admin → Backups**, download the
  newest backup and store it somewhere private (e.g. a password-protected company cloud
  folder). Backups contain customers' personal information: never email or share them.
- Render also takes its own snapshots of the disk. Check the retention in Render's disk
  settings.
- Uploaded **films** are not in the database backup. Keep the original video files safely
  elsewhere so they can be re-uploaded.

### Restoring a backup
1. Render → service → **Shell**. To use one of the daily backups, list them:
   ```bash
   ls /var/data/backups
   cp /var/data/backups/<backup-file>.sqlite /var/data/cultured-africa.sqlite.restore
   ```
   To use a backup you downloaded instead, copy it to the server over SSH (Render → service →
   **Connect → SSH** shows the address; add your SSH key in Render's account settings first):
   ```bash
   scp <downloaded-backup>.sqlite <service-ssh-address>:/var/data/cultured-africa.sqlite.restore
   ```
2. Restart the site: Render → **Manual Deploy → Restart service**.
3. On start-up the site swaps the backup in. It keeps the database it replaced as
   `cultured-africa.sqlite.before-restore-<date>`, in case you need to go back. The log shows
   "Database restored from backup".
4. Check `/health`, log in to the admin portal, and check recent purchases look right.
   Anything that happened after the backup was taken (new accounts, purchases) is not in it:
   compare with the Paystack dashboard and add any missing purchases.

### Monitoring
Create a free uptime monitor (for example UptimeRobot) that checks
`https://culturedafrica.co.za/health` every 5 minutes and emails Cultured Africa if it fails.
Render's **Logs** tab shows errors (e.g. "Receipt email failed", "Paystack webhook").

### Disk space
Render → service → **Disks** shows usage. Each film uses roughly its file size. Increase the
disk size there before it fills up (it can grow but not shrink).

---

## Known limits at launch
- **Report PDF export** relies on Chrome, which isn't installed on Render; the on-screen
  reports work. (The reports still use sample figures; see the change log.)
- **Films are served from the site's own disk.** This is fine for a small catalogue. For
  many viewers, very large files or DRM, move full films to a video streaming service later.
- **One server.** The site uses SQLite and runs as a single instance, which is plenty for a
  small streaming shop. Moving to PostgreSQL is only needed to run several servers at once.
