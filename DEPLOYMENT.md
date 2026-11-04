# Public judge deployment (Vercel)

Canonical public URL: **OWNER TO FILL after the first production deployment**
(for example `https://legal-data-universe.vercel.app/`). Link that canonical
alias in the GitHub README/About field and YouTube description, never a hashed
deployment URL or a LAN address.

## Owner Gate 2 — step-by-step deployment

You do **not** need GitHub finished first. The fastest safe route is the
Vercel CLI from this PC. Do not paste any key into chat, Git, or this file.

### A. Sign in and link the project

1. Open PowerShell.
2. Go to the app folder:

   ```powershell
   cd <path-to-your-clone>\app
   ```

3. Start Vercel login (the first `npx` run may download the CLI; accept it).
   On this PC, PowerShell blocks the `npx.ps1` shim ("running scripts is
   disabled"), so use `npx.cmd` for every `npx` command in this document:

   ```powershell
   npx.cmd vercel login
   ```

   Your browser opens. Sign in to Vercel and approve the CLI.
4. Confirm the CLI sees your account:

   ```powershell
   npx.cmd vercel whoami
   ```

5. Link this folder to a new Vercel project:

   ```powershell
   npx.cmd vercel link
   ```

   Choose your personal/team scope, create a **new** project, and name it
   `legal-data-universe` if available. Accept this folder (`.`) as the root.
6. In the browser, open the new project in Vercel and check
   **Settings → Build and Deployment**:
   - Framework Preset: `Vite`
   - Root Directory: `.` for this CLI-linked `app/` folder
   - Build Command: `npm run build`
   - Output Directory: `dist`
   - Install Command: leave as detected (`npm install`)

   If you later import a GitHub repo whose root is the parent
   `mmdata-meta-hackathon-2026/` folder instead, set Root Directory to `app`.

### B. Add the production secrets (Dashboard — recommended)

1. In the Vercel project, open **Settings → Environment Variables**.
2. For each row below: select **Production**, paste the value, and save.
   Secret values already on this PC can be copied locally from
   `app/server/.env` (open it in Notepad). Never send them in chat/email.

   Required for the live investigation:

   - `INFERENCE_PROVIDER` = `baseten`
   - `BASETEN_API_KEY` = *(secret from `server/.env`)*
   - `BASETEN_BASE_URL` = `https://inference.baseten.co/v1`
   - `BASETEN_MODEL` = `meta-models/muse-spark-open-1026`
   - `PUBLIC_DEMO_ENABLED` = `1`
   - `MAX_PROXY_REQUESTS` = `300` *(per warm instance budget brake)*

   Include for the same behavior as the local build:

   - `FIREWORKS_API_KEY` = *(secret from `server/.env`)*
   - `FIREWORKS_BASE_URL` = `https://api.fireworks.ai/inference/v1`
   - `FIREWORKS_MODEL` = `accounts/fireworks/models/muse-spark-open`
   - `WIT_API_TOKEN` = *(secret; first rotate/create a fresh Wit server token,
     because project notes record the earlier token as exposed in chat)*
   - `WIT_TTS_VOICE` = `Rebecca` *(optional)*

   You may omit Meta-direct keys. With `INFERENCE_PROVIDER=baseten`, the
   public demo will not silently switch provider.
3. Make sure the project is publicly reachable: **Settings → Deployment
   Protection** must not require Vercel authentication for Production.
   Judges will not have your Vercel login.

### C. Deploy once to Preview, check it, then deploy Production

From the same PowerShell window in `app/`:

```powershell
npx.cmd vercel
```

Wait for the build. Chunk-size and Rollup comment warnings are expected and
non-blocking; a red **Error** is not. Open the Preview URL it prints and check:

- the universe and browser controls appear;
- replacing the end of the URL with `/api/health` returns JSON containing
  `"activeProvider":"baseten"` and `"configured":true` for Baseten (no keys);
- Discover → Find Leads → Explore Lead 1 → Prepare Draft Finding works.

Then deploy Production:

```powershell
npx.cmd vercel --prod
```

Copy the **canonical Production domain** from the command output or from
**Project → Domains** in the dashboard. It may be
`https://legal-data-universe.vercel.app/` or a suffixed equivalent. Replace the
placeholder at the top of this file with that exact URL.

### D. Verify like a judge

1. In PowerShell (replace the domain with yours):

   ```powershell
   curl.exe https://YOUR-CANONICAL-DOMAIN/api/health
   ```

   Expect Baseten active/configured and **no credential values**.
2. Open the canonical URL on desktop Chrome: drag to orbit, use arrow keys,
   zoom, click an off-centre glowing record, then run one lead and approve it.
3. Open it on a phone/iPad not using this PC: one finger orbits, pinch zooms,
   tap selects, and Overview / Panel / Evidence presets work.
4. Open it in Quest Browser (ideally on a phone hotspot or other non-LAN
   network): Enter VR and MR, run Lead 1 → Lead 2 → Lead 3, approve one
   finding, use **Export Selected Finding (PDF)**, then export all approved.
5. Put only the canonical URL (not the hashed Preview URL, not `192.168…`) in:
   - the top of the public GitHub `README.md`;
   - the GitHub repository **About → Website** field;
   - the YouTube video description.
6. Keep it live through the Nov 9 finals. Afterwards set
   `PUBLIC_DEMO_ENABLED=0` in Vercel (this keeps the site up but disables
   inference/voice), remove/rotate the demo keys, and check the Baseten,
   Fireworks, and Wit dashboards.

### If something goes wrong

- **The page loads but AI fails:** open `/api/health`. If Baseten is not
  `configured:true`, the Production env vars were added to Preview only or the
  key name is misspelled. Fix, then run `npx.cmd vercel --prod` again.
- **`/api/health` is 404:** the Root Directory is wrong. It must be the folder
  containing both `index.html` and `api/` (`.` here, or `app` from repo root).
- **Judges would hit a login/403:** turn off Production Deployment Protection.
- **429 from `/api/chat`:** the demo budget/rate brake tripped. Raise
  `MAX_PROXY_REQUESTS` deliberately or redeploy; check provider spend first.
- **Voice unavailable but investigation works:** `WIT_API_TOKEN` is missing or
  stale. The app is designed to continue by tap; rotate the token and redeploy.
- **Build fails before deploy:** run `npm run validate` locally first. Do not
  publish a preview URL as a substitute for fixing the production build.

## Security notes

The Vite dev proxy remains local-only. Production functions in `api/` reuse
`server/api-handlers.mjs`; keys exist only as Vercel environment variables.
Chat/voice endpoints are rate-limited per IP per warm instance, request bodies
are capped, and logs contain provider/model/usage metadata only. Rate limits
are a demo brake, not a billing guarantee — watch the Baseten dashboard.
