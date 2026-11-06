# NEXUS Care Workbench — prototype

**DEMO ENVIRONMENT • SYNTHETIC DATA • NOT FOR CLINICAL USE**

A payer-side case-management workbench for an RN case manager (demo persona: Maria Chen).
*One trusted member view. One prioritised queue. One human-approved next step.*

Static HTML/CSS/JS. No build step, no backend, no API keys, no external AI, no internet needed at runtime
(the font and icons are bundled). Deploys to Vercel as-is.

## Run locally

```bash
cd nexus-vercel
python3 -m http.server 8000
# open http://localhost:8000
```

It must be served over HTTP: opening `index.html` directly from disk blocks the data `fetch`.

## Deploy to Vercel

- **Dashboard:** push this folder to GitHub → vercel.com → *Add New Project* → import → Framework Preset **Other**,
  leave Build Command and Output Directory empty → Deploy.
- **CLI:** `npm i -g vercel && vercel --prod` from this folder.

`<meta name="robots" content="noindex">` is set. Consider Vercel password protection for shared demos.

## Data: the workbook is the source of truth

`data/NEXUS_Updated_Product_Data_Annex.xlsx` is converted to `data/nexus-data.json`. Nothing is ever written back to the workbook.

```bash
pip install openpyxl
python scripts/build_data.py data/NEXUS_Updated_Product_Data_Annex.xlsx
```

The script stops with a clear error if a required sheet or column is missing. On load, the app checks the data again:

- all required sheets are present
- the five member IDs NX-001 … NX-005 are present
- recalculated scores equal the workbook **and** the brief: 85.8 · 81.0 · 76.0 · 65.9 · 61.8
- the bands match (3 High, 2 Medium)
- the Task Queue starts with 5 tasks, all Open
- every member has a Contact Directory record

If a critical check fails, the app shows the error and **does not fall back to invented data**. The results of the checks appear under *Insights & Data Trust → Data validation on load*.

Priority score = 0.40 × Clinical acuity + 0.25 × Time sensitivity + 0.20 × Care-gap severity + 0.15 × Access barriers.
Bands: High ≥ 75 · Medium 50–74 · Routine < 50.
This is an illustrative operational work-queue score, not a clinical prediction.

## The four tabs

| Tab | What it answers | Key features |
|---|---|---|
| **Today's Queue** (default) | Who first, why now, whom to contact, what next | KPI strip (48 shown as illustrative only, next to "5 sample cases loaded") · search + filters that combine and can be reset · cards sorted by score with Why-Now chips, next step, recommended contact + permission status, task/due · defer/reassign with a required reason · event feed (event time ≠ received time) · **Simulate discharge event** |
| **Member 360** | Current story, how reliable each fact is, whom it is safe to contact | Summary with the score broken down by factor · latest event / medication / follow-up / task tiles · facts grouped by provenance (verified, member-reported, historical, missing, conflicting) · medication shown as four separate concepts (order ≠ fill ≠ report ≠ adherence) · source timeline · **contact-routing card** (target, evidence, scope, restricted disclosure, rule applied) · data-trust panel with conflicts shown side by side · **Simulate case status** (Community / Inpatient / Recently discharged) |
| **Outreach & Notes** | How to prepare, what is safe to ask, how to turn the call into accountable work | Pre-call brief with coordination-only questions · **manual notes (MVP 1)** with typed dictation and no microphone · third-party contact blocked until identity and scope are confirmed · template draft (note, assessment, care-plan suggestions, tasks) with Approve / Edit / Reject per section · **AI Call Scribe, Phase 2 simulation** (consent gate, recording OFF by default, synthetic transcript, declined → back to manual notes) · task lifecycle (approve, start, complete, reopen with a reason, edit, view evidence) · audit trail |
| **Insights & Data Trust** | Is the workflow working, are data gaps visible, are the AI features safe | Queue/task pulse · contact safety (third-party compliance shows "No attempts recorded" until attempts exist) · freshness × member matrix · AI-quality states ("Not measured", "Demo only", "Baseline pending") with real session counts · 480-minute day labelled as a discovery hypothesis · pilot KPI targets labelled as hypotheses · data validation · risks |

**Copilot:** the button on the right edge opens a side drawer on every tab, and the page underneath stays as it is.
It is context-aware (tab, member, role, simulated status) and answers from local rules and templates, with a **Sources** list on each answer.
It turns down requests to diagnose, prescribe, choose a dose or triage. When the data doesn't support an answer, it replies "I cannot verify this from the connected demo data".
"Draft a task…" creates a *Draft* that the nurse must approve.

## Contact-routing rules (Contact Directory + Contact Routing Rules sheets)

- **NX-001:** call John first. Ellen is LIMITED SCOPE (discharge, transport and medication-access logistics).
- **NX-002:** call Evelyn first. Laura is LIMITED SCOPE (appointment and transport logistics).
- **NX-003:** the member's number is DISCONNECTED, so there are no retries. Resolve the identity (NX-003A) first. James is REVIEW REQUIRED until his scope is re-confirmed.
- **NX-004:** privacy-sensitive, so contact is member-only through a safe channel. Third parties are suppressed. Escalate to a supervisor if no safe route can be found.
- **NX-005:** call Nina first. Arjun is LIMITED SCOPE (appointment and transport logistics).
- **Inpatient simulation:** the target switches to the hospital care coordinator / discharge planner, and a discharge-coordination task can be added.

## Demo state

All edits (simulated events, case-status simulations, drafts, tasks, notes, audit trail and Copilot history) live in `sessionStorage` for the current browser tab.
**Reset demo** (top bar) restores the workbook starting state.

## Project structure

```
index.html                 shell (banner, header, view, Copilot drawer)
css/app.css                design system (HiLabs palette) + layout
js/logic.js                priority engine, contact router, why-now, data trust, call brief, note drafter, Copilot rules
js/app.js                  state, validation, four tabs, Copilot drawer, actions, audit
js/icons.js                Lucide icon subset (ISC — assets/LUCIDE-LICENSE.txt)
assets/                    logo, Inter variable font (OFL)
data/                      workbook + generated JSON
scripts/build_data.py      workbook → JSON with column validation
```

## Out of scope by design

There are no live EHR, ADT, payer, PBM, HIE, FHIR, telephony or claims connections. The prototype does not record audio or use a real microphone, does not use an LLM, and does not write anything back.
The app never makes autonomous clinical decisions. RICE and MoSCoW decided the build scope; they are not tabs in the app.
