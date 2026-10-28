# ProjextArt

A small artist portfolio built with React, Vite, and Express.

## Run locally

```bash
npm install
$env:ADMIN_USERNAME = "admin"
$env:ADMIN_PASSWORD = "choose-a-long-private-password"
$env:TOTP_SECRET = (node server/generate-totp-secret.js)
npm run dev
```

The Vite app runs at `http://localhost:5173` and proxies artwork data to the Express API at `http://localhost:3001`.

The admin portal is at `/apps/admin_` or on an `admin.` subdomain. Sign in with `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and a time-based one-time password (TOTP). Generate a cryptographically random Base32 secret with `node server/generate-totp-secret.js`, set it as `TOTP_SECRET` in the server environment, then add that same secret to Google Authenticator or another TOTP app using manual setup and the time-based option. A successful sign-in starts a 10-minute idle session. Admin activity refreshes the idle timer; after 10 minutes without activity the session expires. The session cookie is HTTP-only, and you can end the session sooner with the sign-out button. Keep all three credentials private and reuse the same values when restarting the server. Use HTTPS when deploying.

The public navigation links to separate Comics and Books pages; neither collection appears in the home-page gallery. In the admin portal, choose Comic to upload ordered image pages, or Book to upload a PDF or ordered page images. Each upload can contain up to 30 files, with a 20 MB limit per file. Only JPG, PNG, GIF, WEBP, and PDF files are accepted.

Mark an item as locked to show its title and year in its public listing without exposing its files. Locked media is only returned to an authenticated admin and direct upload URLs require the admin session. After signing in to the admin portal, preview gallery images or PDFs, edit an item's title, year, description, and lock status, and delete items.

Uploads and their SQLite catalog are stored in the ignored `data/` directory, so they persist between restarts and are not committed to Git. Keep a backup of this directory when deploying. The server requires Node.js 22.5 or newer for its built-in SQLite module. To configure sign-in or storage, set `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `TOTP_SECRET`, `DATA_DIRECTORY`, `DATABASE_PATH`, or `UPLOAD_DIRECTORY` in the server environment before starting it. On Windows PowerShell, set the three admin variables with `$env:ADMIN_USERNAME`, `$env:ADMIN_PASSWORD`, and `$env:TOTP_SECRET`; on macOS/Linux, export them. If any admin credential is missing, sign-in and uploads remain disabled.

## Production

```bash
npm run build
$env:ADMIN_USERNAME = "admin"
$env:ADMIN_PASSWORD = "choose-a-long-private-password"
$env:TOTP_SECRET = "the-same-base32-secret-used-for-enrollment"
npm start
```

The production server serves the built app, uploaded files, and gallery API on port `3001`.