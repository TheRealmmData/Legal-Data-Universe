# Legal Data Universe — Immersive Analytics for Legal Data

**Try it live:** `TO BE ADDED AT SUBMISSION — canonical public demo URL`
(works in Quest Browser, desktop, phone, and tablet — no install)

**Watch the demo video:** `TO BE ADDED AT SUBMISSION — video URL`

Legal Data Universe puts an investigator *inside* a legal document
collection. Instead of reading 3,000 documents one flat list at a time,
you stand in a spatial universe where custodians, chronology, concepts,
and file types form visible structure — then you ask a source-grounded
AI to find leads, explore the evidence behind each one, and draft a
finding that only becomes work product when an attorney approves it.

**The AI proposes. The attorney decides.**

Built by **mmData** (Melissa Heidrick) for the Meta Global AI Developer
Hackathon 2026. The demo matter (NovaChip / Reyes) is entirely fictional.
Nothing here is connected to any production eDiscovery platform or real
client data.

## The 90-second demo path

1. Say **"Find leads"** (or tap Discover → Find Leads). The AI returns
   three sequenced investigative leads over the fictional collection.
2. **Explore Lead 1** — the universe reorganizes and the supporting
   evidence lights up. Ask follow-up questions by voice or text, or go
   straight to **Prepare Draft Finding**.
3. Review the draft: verbatim quotes, source records, and the evidence
   *against* the theory are shown with it. **Approve Draft Finding** or
   **Reject Draft Finding**.
4. Repeat for Lead 2, then **Lead 3 — the smoking gun**.
5. **Export** one approved finding or all of them: a partner-readable
   PDF findings memo with provenance, scope, and grounding at the end,
   plus a JSON companion, delivered as a ZIP.

A sample of the real exported memo is in this repo:
[`artifacts/legal-data-universe-findings-memo.pdf`](artifacts/legal-data-universe-findings-memo.pdf)

## Why spatial?

We claim only that immersive analytics *may* improve sensemaking — and
we cite checkable sources:

- IDC forecasts the global datasphere growing from **149 zettabytes in
  2024 to more than 394 zettabytes in 2028** (IDC Global DataSphere
  Forecast, 2024–2028).
- In a peer-reviewed memory-palace study, headset users recalled
  **significantly more information locations** than desktop users
  (Krokos et al., *Virtual Reality* 23, 2019,
  doi:10.1007/s10055-018-0347-3).
- In a controlled network-visualization study, VR users were more
  accurate on one relational task with lower mental demand (Huang et
  al., *Information Visualization* 22(4), 2023).

We do **not** claim VR is always better. Space makes relationships
visible; precise source inspection stays one tap away. Our interaction
cycle — SELECT → ASK → RETRIEVE → EXPLAIN → VERIFY → DECIDE — is a
design sequence, not a study result.

## Controls

| Surface | How |
|---|---|
| Quest VR/MR | Hands first (gaze-and-pinch, hand rays); controllers work. **X** push-to-talk for voice. Expand/Compact Universe for room scale. |
| Desktop | Drag to orbit, scroll/pinch to zoom, WASD/arrows to move, Q/E, **R** reset view, **X** voice, click glowing records and panels. Preset views: Overview / Panel / Evidence. |
| Phone / tablet | One finger orbits, pinch zooms, tap selects. Exports open the share sheet so files actually save. |

Voice: the headset uses Wit.ai speech; desktop uses the browser's Web
Speech with a Wit fallback. Every button and every phrase on the
in-app Voice Help card is voice-addressable. Tap/click mode is silent —
speech only answers speech.

**A note on voice quality:** voice works best *in immersion*, where
the headset microphone sits inches from your mouth. On desktop, phone,
and tablet, the microphone may be across the room and results vary —
on those devices you'll get the most dependable experience from the
tool buttons, which cover everything voice can do.

## Run it locally

Prerequisites: Node 24 LTS (matches `.nvmrc`), npm.

```powershell
npm install
npm run dev        # IWSDK dev session (HTTPS); prints local + LAN URLs
npm run validate   # typecheck + production build + full offline test suite
```

- **Desktop:** open the local HTTPS URL, accept the development
  certificate, explore in 2D or choose **Enter XR** (emulator).
- **Quest 3:** on the same Wi-Fi, open the LAN HTTPS URL in Quest
  Browser, accept the certificate warning, then **Enter XR** for VR or
  **Enter MR (Passthrough)** for mixed reality.
- AI keys are server-side only (see `.env.example` and
  `DEPLOYMENT.md`); no key ever ships to the browser.

## Architecture

- **Runtime:** WebXR via Meta's Immersive Web SDK (IWSDK 1.1, Three.js +
  ECS, Vite). One scene serves desktop 2D, Quest VR (`immersive-vr`),
  and Quest MR (`immersive-ar`); VR-only scenery hides automatically in
  passthrough.
- **AI:** Meta **Muse Spark** (`meta-models/muse-spark-open-1026`)
  served by **Baseten**, behind a same-origin proxy (`/api/chat`,
  `/api/stt`, `/api/tts`, `/api/health`). Leads are discovered live
  over deterministic evidence tools that return record IDs; a QC
  specialist path guarantees a credible demo if a live response misses
  the grounding bar. Every finding cites its sources; nothing exports
  without explicit human approval.
- **Exports:** PDF findings memo (primary) + JSON companion in a ZIP,
  generated entirely client-side from the approved findings.
- **Integrity rules:** every displayed number and AI assertion traces
  to source records; illustrative placement is labelled illustrative;
  the demo matter is labelled fictional.

## Verification

`npm run validate` runs typecheck, the production build, and the
offline suites (eval, evidence, runner, investigation, inference,
retrieval, discovery, demo-export, voice, clustering, ambience) —
471 checks passing on the frozen submission build
(tag `freeze-2026-11-04`). The owner's manual
regression script is [`REGRESSION.md`](REGRESSION.md); deployment steps
are in [`DEPLOYMENT.md`](DEPLOYMENT.md).

## Who we are

We are **mmData**.

- WE BUILD TRULY USEFUL TOOLS FOR LEGAL PROFESSIONALS.
- WE PARTNER WITH THE MOST BRILLIANT MINDS IN LEGAL AND TECH.
- WE SUPPORT SUSTAINABLE AND EQUITABLE TECHNOLOGY FRAMEWORKS FOR THE
  BENEFIT OF ALL.

## License

Legal Data Universe is licensed under the GNU Affero General Public
License v3.0 — see [`LICENSE`](LICENSE). It builds on the MIT-licensed
IWSDK starter (Meta Platforms, Inc. and affiliates); dependency
licences are recorded in `package-lock.json`.
