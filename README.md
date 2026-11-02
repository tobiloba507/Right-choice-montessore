# Right Choice Montessori School website

## Run locally

This site uses Node.js 22.5 or later and its built-in SQLite support. It does not need third-party packages.

1. Open a terminal in this project folder.
2. Run `npm.cmd run setup-admin` in PowerShell (`npm run setup-admin` on other shells) and follow the prompts. The password prompt is masked; use a unique password with at least 12 characters.
3. Run `npm.cmd start` in PowerShell (`npm start` on other shells).
4. Open `http://127.0.0.1:3000` for the public site or `http://127.0.0.1:3000/admin/login` for the staff inbox.

The setup creates an ignored `.env` file containing a scrypt password hash and a random session secret. Submission records are stored in the ignored `data/school.sqlite` SQLite database. Keep both files private and backed up securely.

## Admin and production deployment

The admin inbox requires a server-side login. Sessions use random opaque tokens in `HttpOnly`, `SameSite=Strict` cookies; sign-in attempts and public submissions are rate limited. Admin pages and inbox APIs are protected on the server. Do not publish this static site on a file host or expose the development server to the internet.

For production, deploy the Node server behind an HTTPS reverse proxy, set `NODE_ENV=production`, configure a private persistent database location and backups, and keep `.env` out of source control. The app binds to `127.0.0.1` by default; set `HOST=0.0.0.0` only when your trusted hosting setup requires it. Confirm the hosting platform supports Node.js 22.5+ and persistent SQLite storage before deployment.

The public forms post to `/api/submissions` on the same host as the Node server. A static Netlify deployment alone does not provide this API, so forms will not reach the staff inbox until the Node server is deployed and the website's domain or `/api/*` requests are routed to it. The staff inbox is available at `/admin/login` on that server.

The public “Listen to this section” controls use the browser's built-in speech synthesis. Read-aloud availability and voice quality depend on the visitor's device and browser.
