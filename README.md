# Right Choice Montessori School website

## Run locally

This site uses Node.js 22.5 or later and its built-in SQLite support. It does not need third-party packages.

1. Open a terminal in this project folder.
2. Run `npm.cmd run setup-admin` in PowerShell (`npm run setup-admin` on other shells) and follow the prompts. The password prompt is masked; use a unique password with at least 12 characters.
3. Run `npm.cmd start` in PowerShell (`npm start` on other shells).
4. Open `http://127.0.0.1:3000` for the public site or `http://127.0.0.1:3000/admin/login` for the staff inbox.

The setup creates an ignored `.env` file containing a scrypt password hash and a random session secret. Submission records are stored in the ignored `data/school.sqlite` SQLite database. Keep both files private and backed up securely.

## Admin and production deployment

The admin inbox requires a server-side login. Sessions use random opaque tokens in `HttpOnly`, `SameSite=Strict` cookies; sign-in attempts and public submissions are rate limited. Leaving or hiding the dashboard locks it by revoking the server session, so staff must sign in again to reopen it. Admin pages and inbox APIs are protected on the server. Do not publish this static site on a file host or expose the development server to the internet.

For production, deploy the Node server behind an HTTPS reverse proxy, set `NODE_ENV=production`, configure a private persistent database location and backups, and keep `.env` out of source control. The app binds to `127.0.0.1` locally and defaults to `0.0.0.0` in production. On Render, it always binds to `0.0.0.0` and uses Render's `PORT`, even if a `HOST` variable is set incorrectly. Confirm the hosting platform supports Node.js 22.5+ and persistent SQLite storage before deployment.

For a Netlify frontend with the Node server on Render, deploy the root `_redirects` file so Netlify proxies `/api/*`, `/admin`, `/admin/*`, and `/admin.js` to the Render service. The default allowed origin is `https://right-choice-school.netlify.app`. If you use a different Netlify site URL or custom domain, add its exact origin(s) to the comma-separated `ALLOWED_ORIGINS` setting in Render. This lets the backend verify form and admin requests coming through the proxy while continuing to reject other origins. The Netlify and Render services must both be deployed for the forms and protected staff inbox to work.

The public “Listen to this section” controls use the browser's built-in speech synthesis. Read-aloud availability and voice quality depend on the visitor's device and browser.
