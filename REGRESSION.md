# Legal Data Universe — Owner Regression Script

Purpose: one repeatable pass that proves the demo still works end
to end after any change. Run top to bottom; tick each box. Any
failure: write the section number and what you saw, and tell the
agent — the diag log (`server/diag.log` on this PC) holds the
forensics (heard transcripts, intents, export sizes).

Order matters: automated gates first (Section 0), then desktop
2D, then voice, then the golden-path investigation, then
exports per platform, then Quest XR, then iPad. Estimated total:
35–45 minutes; Sections 0–5 alone are the 15-minute smoke pass.

## 0. Automated gates (PC, PowerShell)

```powershell
cd <path-to-your-clone>\app
npm.cmd run validate
```

- [ ] `validate` exits green (typecheck + build + all suites).
- [ ] Start the app and leave the window running:

```powershell
npm.cmd run dev
```

- [ ] New browser tab (not the auto-opened emulator workspace):
  `https://localhost:8081/` loads the universe; Quest/iPad on
  the same Wi-Fi use the LAN URL the dev session prints
  (`https://<your-PC-LAN-address>:8081/`).
- [ ] Health: open `https://localhost:8081/api/health` — JSON
  renders, no error, no keys visible.

## 1. Desktop 2D basics (no voice)

- [ ] Drag orbits; scroll/+/− zooms; Q/E lower/raise; R resets.
- [ ] **Overview / Evidence / Panel** preset buttons each move
  the camera and show the right status line.
- [ ] WASD and arrow keys move; clicking a glowing record opens
  its source card with title, excerpt, and signals.
- [ ] **Tap-silence rule**: click through Investigate and
  Explore buttons for a minute. NOTHING is read aloud. Any
  speech = fail (note which button).
- [ ] Switch tabs/lenses quickly by clicking. No narration
  trails behind the view changes.
- [ ] Explore tab has NO Next Hit / Previous Hit buttons
  (cut 2026-11-03). Search results still step with Next Hit /
  Previous Hit inside Search (Section 3).

## 2. Desktop voice (X key + Voice button)

Setup: click the 3D view once (keyboard focus), then for each
phrase: press **X**, wait for LISTENING, speak, pause ~2 s.
Expect the speech log to show what was heard and the action to
fire. Spoken replies ARE expected here (voice-initiated).

Leads & investigation:
- [ ] "Find leads" → three lead cards, Lead 3 = smoking gun framing.
- [ ] "Investigate leads" → same (never staged as a question).
- [ ] "Explore lead one" / "Explore lead two" / "Explore lead
  three" → universe reorganizes to that lead's lens and its
  evidence is **brighter/larger** against a dimmed field.
- [ ] "Prepare draft finding" → a draft is queued (Export shows
  it pending); "Show tools" / "Hide tools" expand/collapse.
- [ ] "Search for the term escrow" → hits highlighted, count spoken.
- [ ] "Next hit" / "Previous hit" step the source card through hits.
- [ ] "Add to report" after a search → hit count saved to the
  Search Term Hit Report.

Navigation & lenses:
- [ ] "Take me to concept clusters", "Show custodians",
  "Show file types", "Chronology", "Organize by file type",
  "Organize by organization", "Lens evidence" — each changes
  the arrangement and announces the view.
- [ ] "Take me to Search", "Take me to Explore",
  "Take me to Investigate", "Visit the export tool to explore
  options" — each opens the right tab.

System phrases:
- [ ] "Soundscape" toggles and announces ON/OFF correctly.
- [ ] "Voice help" opens the help card.
- [ ] "Exit to browser" / "Enter virtual reality" answer with
  tap-only guidance naming the exact button (by design).
- [ ] "Approve that finding" / "Export everything" answer
  tap-only — approvals/exports NEVER run by voice.
- [ ] After any voice use: click any button. It must act
  silently (tap ends the voice turn).
- [ ] Mishear resilience (speak naturally, don't enunciate):
  "find leads", "show tools", "explore lead three" each land
  within two tries.

## 3. Golden-path investigation (the demo story)

Tap path and voice path must both reach exportable work:

- [ ] Find Leads → Explore Lead 1 → Prepare Draft Finding →
  Export shows the draft pending.
- [ ] **Approve Draft Finding** (tap) → banner says RECORDED:
  APPROVED – WILL EXPORT; queue advances to any next draft.
- [ ] Repeat for Lead 2, then **Lead 3 (smoking gun)**: explore
  shows the external send + receipt language; draft shows the
  fingerprint match with verbatim quotes AND counterevidence
  (the same-name public extract with a DIFFERENT fingerprint).
- [ ] One follow-up question on any lead (voice or typed) →
  card reminds: you can draft the defined finding (shown
  again), ask more, or move on without drafting.
- [ ] Chat red herrings visible in records (Teams chat gossip)
  but never cited as conclusions in a draft.

## 4. Exports (desktop, then per-platform in §6–7)

Requires ≥1 approved finding from §3.

- [ ] **Export Selected Finding (PDF)**: preview tap, then
  download tap. Card says "download started". File
  `legal-data-universe-findings-memo.pdf` is in browser
  Downloads AND in `app\exports\` on this PC.
- [ ] Open the PDF: finding first, verbatim quotes page-style
  (Bates-like), counterevidence after, provenance / scope /
  searches / audit LAST. Bottom line reads clearly.
- [ ] **Export All Approved (PDF Memo)**: all approved findings
  present, in order.
- [ ] **Export All as ZIP**: ZIP contains the memo PDF,
  `approved-findings.json`, both CSVs, README. Open it.
- [ ] Export with NOTHING approved (fresh reload): PDF export
  says nothing is approved; ZIP still downloads reports-only
  and says so honestly; no crash, no claim of a memo.

## 5. Search & hit stepping

- [ ] Keyword search "Falcon" → hit count + highlighted hits.
- [ ] Next Hit / Previous Hit (Search buttons) step records;
  saying "next hit" does the same by voice.
- [ ] "Search nightjar" (suggestion button and voice) works.
- [ ] Prepare New Search Suggestions rotates suggestion labels
  and the labels match what the buttons run.
- [ ] Clear Search removes highlights and restores the field.

## 6. Quest XR (headset, LAN URL)

Open the LAN URL the dev session prints
(`https://<your-PC-LAN-address>:8081/`) in Quest Browser (accept the
certificate warning once). Do VR first, then repeat the starred
items in MR (passthrough).

- [ ] Enter Virtual Reality → universe surrounds; panel readable.
- [ ] Joystick move + jump (A) work; trigger selects records;
  source cards readable at panel distance.
- [ ] * Find Leads by **X push-to-talk**; Lead 3 evidence
  highlights; Prepare + Approve Draft Finding (tap) works.
- [ ] * Export All as ZIP → file appears in Quest Files /
  browser Downloads.
- [ ] **Guardian**: walk across the boundary and stay out
  >1 s → app exits to browser cleanly (platform behavior),
  re-enter works.
- [ ] Walk/jump off the platform edge → you respawn; select
  and jump still work afterward.
- [ ] Soundscape toggle audibly on/off; spoken replies only
  during voice turns, never while tapping.
- [ ] Session survives 10 minutes of mixed use (no freeze).

## 7. iPad (Safari, LAN URL)

- [ ] Page loads; one-finger drag orbits, pinch zooms, taps
  select records and buttons.
- [ ] Voice button (no X key): "find leads", "show tools"
  land within two tries.
- [ ] **Export All as ZIP → iOS share sheet appears → Save to
  Files → file present in Files > Downloads.** Same for a
  single-finding PDF export.
- [ ] Layout: status bar, preset buttons, and panel all usable
  in portrait and landscape.

## 8. Failure honesty (spot-check any two)

- [ ] Block the microphone (site settings) → Voice explains the
  exact fix; everything else still works by tap.
- [ ] Ask an out-of-scope question ("delete the bad emails") →
  refused with guidance, nothing staged destructively.
- [ ] Say "stop" mid-AI-run → run cancels, app stays responsive.
- [ ] Export before approving → clear reason, no fake success.

## Sign-off

- Date / build (commit): ____________________
- Sections passed: ______  Failed (note what you saw): ______
- Physical devices used: PC ☐  Quest VR ☐  Quest MR ☐  iPad ☐
- Verdict: PASS / PASS WITH NOTES / FAIL

Automated companion: `npm.cmd run validate` (typecheck, build,
10 suites incl. per-button voice coverage). This script covers
what automation cannot: devices, downloads, and being believed.
