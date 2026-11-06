/* NEXUS Care Workbench — UI layer.
   DEMO ENVIRONMENT • SYNTHETIC DATA • NOT FOR CLINICAL USE.
   All edits live in sessionStorage for this browser tab only; the workbook data is never modified. */
(function () {
  'use strict';
  const L = window.NXL, IC = window.NX_ICONS || {};
  const CFG = { TODAY: '2026-11-06', USER: 'Maria Chen', ROLE: 'RN Case Manager', CASELOAD: 48, OWNERS: ['Maria Chen', 'David Ortiz'] };
  const TABS = [
    { id: 'queue', name: "Today's Queue", icon: 'list-checks', q: 'Who needs attention first, why now, whom should I contact, and what should I do next?' },
    { id: 'm360', name: 'Member 360', icon: 'user-round', q: 'What is the current story, how reliable is each piece of data, and whom can I safely contact?' },
    { id: 'outreach', name: 'Outreach & Notes', icon: 'phone-call', q: 'Prepare the conversation, ask what is safe to ask, and turn it into accountable follow-up.' },
    { id: 'insights', name: 'Insights & Data Trust', icon: 'shield-check', q: 'Is the workflow functioning, are data gaps visible, and are AI features safe and useful?' },
  ];
  const EXPECTED = { 'NX-001': 85.8, 'NX-002': 61.8, 'NX-003': 81.0, 'NX-004': 65.9, 'NX-005': 76.0 };
  const REQUIRED_SHEETS = ['Patient 360', 'Source Records', 'Task Queue', 'Contact Directory', 'Contact Routing Rules', 'KPI Definitions', 'Priority Model', 'Risks', 'Call AI Workflow', 'Data Dictionary'];
  const SKEY = 'nexus-care-workbench-demo-v2';
  const ACTIVE = ['Open', 'In Progress'];
  let D, P, S, CHECKS = [], modalCb = null;

  /* ================================================================== helpers */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n] || ''}</svg>`;
  const $ = (s, r = document) => r.querySelector(s);
  const pad = (n) => String(n).padStart(2, '0');
  const now = () => new Date();
  const hhmm = (d = now()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const stamp = (d = now()) => `${CFG.TODAY} ${hhmm(d)}`;
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmtDate = (iso, year) => { if (!iso || !/^\d{4}-\d\d-\d\d/.test(iso)) return esc(iso || '—'); const d = new Date(iso.slice(0, 10) + 'T12:00:00'); return `${DAYS[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}${year ? ' ' + d.getFullYear() : ''}`; };
  const dayDiff = (iso) => Math.round((Date.parse(iso + 'T12:00:00') - Date.parse(CFG.TODAY + 'T12:00:00')) / 864e5);
  const initials = (n) => String(n).split(/\s+/).map((x) => x[0]).join('').slice(0, 2).toUpperCase();
  const chip = (t, tone = 'muted', ic) => `<span class="chip t-${tone}">${ic ? icon(ic) : ''}${esc(t)}</span>`;
  const simChip = () => chip('SIMULATED', 'sim', 'flask-conical');
  const bandChip = (b) => `<span class="band ${b}">${b === 'High' ? icon('zap', 'sm') : ''}${b}</span>`;
  const PERM_IC = { PERMITTED: 'circle-check', 'LIMITED SCOPE': 'scale', 'REVIEW REQUIRED': 'triangle-alert', 'NOT AUTHORISED': 'ban', DISCONNECTED: 'phone-off', UNVERIFIED: 'lock' };
  const perm = (s) => `<span class="perm ${String(s).split(' ')[0]}">${icon(PERM_IC[s] || 'info')}${esc(s)}</span>`;
  const note = (html, tone = '', ic = 'info') => `<div class="note ${tone}">${icon(ic)}<div>${html}</div></div>`;
  const opt = (v, cur, label) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(label ?? v)}</option>`;
  const M = (mid) => P.find((p) => p.id === mid);
  const firstName = L.firstName;

  function ring(score, lg) {
    const sz = lg ? 84 : 56, sw = lg ? 7 : 5, r = (sz - sw) / 2, c = 2 * Math.PI * r, f = Math.max(0, Math.min(1, score / 100));
    return `<div class="ring ${lg ? 'lg' : ''}" role="img" aria-label="Priority score ${score.toFixed(1)} of 100"><svg width="${sz}" height="${sz}"><circle cx="${sz / 2}" cy="${sz / 2}" r="${r}" fill="none" stroke="#E2E6F3" stroke-width="${sw}"/><circle cx="${sz / 2}" cy="${sz / 2}" r="${r}" fill="none" stroke="${score >= 75 ? '#1E2560' : '#2F6BFF'}" stroke-width="${sw}" stroke-linecap="round" stroke-dasharray="${(c * f).toFixed(1)} ${c.toFixed(1)}"/></svg><span class="val">${score.toFixed(1)}</span></div>`;
  }

  /* ================================================================== state */
  const freshTasks = () => D['Task Queue'].map((t) => ({ id: t['Task ID'], mid: t['Member ID'], priority: t['Priority'], title: t['Task / next action'], status: t['Status'],
    due: String(t['Due date']).slice(0, 10), owner: t['Owner'], approval: t['Approval'], evidence: t['Evidence / rationale'], origin: 'Workbook · Task Queue' }));
  const freshState = () => ({ tab: 'queue', sel: P[0].id, f: { q: '', band: '', prog: '', cm: '', status: '', task: '', exc: false }, caseSim: {}, events: [], tasks: freshTasks(),
    form: {}, drafts: {}, notes: [], audit: [], attempts: [], overrides: 0, copilot: { open: false, msgs: [] }, mode: 'manual', scribe: {}, asked: {}, simTarget: P[0].id,
    stats: { drafts: 0, approved: 0, edited: 0, rejected: 0, consentGiven: 0, consentDeclined: 0, cpTotal: 0, cpGrounded: 0 }, seq: 1 });
  function save() { try { sessionStorage.setItem(SKEY, JSON.stringify(S)); } catch (e) { /* storage unavailable: state stays in memory */ } }
  function load() { try { const s = JSON.parse(sessionStorage.getItem(SKEY)); if (s && s.tasks && s.f) return Object.assign(freshState(), s); } catch (e) { /* ignore */ } return freshState(); }
  function log(action, mid, detail, reason) { S.audit.unshift({ t: hhmm(), actor: CFG.USER, action, mid: mid || '', detail: detail || '', reason: reason || '' }); }

  const eff = (m) => S.caseSim[m.id] || m.raw['Case status'];
  const simFor = (mid) => S.events.filter((e) => e.mid === mid && e.kind === 'discharge').slice(-1)[0] || null;
  const routeFor = (m) => L.route(D, m.raw, eff(m));
  const tasksFor = (mid) => S.tasks.filter((t) => t.mid === mid);
  const reportedMeds = (mid) => S.notes.filter((n) => n.mid === mid && n.medication).map((n) => n.medication);
  function primaryTask(mid) {
    const ts = tasksFor(mid);
    return ts.find((t) => ACTIVE.includes(t.status)) || ts.find((t) => t.status === 'Draft') || ts.find((t) => t.status === 'Deferred') || ts[ts.length - 1] || null;
  }
  function dueInfo(t) {
    if (!t) return ['No task', 'muted', 'circle-dashed'];
    if (t.status === 'Completed') return ['Completed', 'ok', 'circle-check'];
    if (t.status === 'Deferred') return ['Deferred', 'muted', 'hourglass'];
    if (!t.due) return ['No due date', 'muted', 'calendar'];
    const d = dayDiff(t.due);
    if (d < 0) return [`Overdue ${-d}d`, 'crit', 'triangle-alert'];
    if (d === 0) return ['Due today', 'warn', 'clock'];
    return [`Due ${fmtDate(t.due)}`, 'muted', 'calendar'];
  }
  const STATUS_TONE = { Open: 'info', 'In Progress': 'info', Completed: 'ok', Deferred: 'muted', Draft: 'sim' };
  const taskChip = (t) => (t ? chip(t.status === 'Draft' ? 'Draft · needs approval' : t.status, STATUS_TONE[t.status] || 'muted') : chip('No task', 'muted'));
  const contactException = (m) => { const c = L.memberContact(D, m.id); const s = L.contactStatus(D, m.raw, c); return s === 'DISCONNECTED' || s === 'UNVERIFIED'; };

  /* ================================================================== validation */
  function validate(raw) {
    const checks = [];
    const missing = REQUIRED_SHEETS.filter((s) => !Array.isArray(raw[s]));
    checks.push({ ok: !missing.length, fatal: true, text: missing.length ? `Missing sheet(s): ${missing.join(', ')}` : `All ${REQUIRED_SHEETS.length} required sheets loaded` });
    if (missing.length) return checks;
    const ids = raw['Patient 360'].map((r) => r['Member ID']);
    const miss = Object.keys(EXPECTED).filter((i) => !ids.includes(i));
    checks.push({ ok: !miss.length, fatal: true, text: miss.length ? `Missing member ID(s): ${miss.join(', ')}` : 'Five expected member IDs present (NX-001 … NX-005)' });
    const bad = raw['Patient 360'].filter((r) => EXPECTED[r['Member ID']] !== undefined && (L.score(r) !== EXPECTED[r['Member ID']] || Number(r['Priority score']) !== EXPECTED[r['Member ID']]));
    checks.push({ ok: !bad.length, fatal: true, text: bad.length ? `Score mismatch: ${bad.map((r) => `${r['Member ID']} calc ${L.score(r)} vs ${r['Priority score']}`).join('; ')}` : 'Recalculated scores match workbook: 85.8 · 81.0 · 76.0 · 65.9 · 61.8' });
    const bandBad = raw['Patient 360'].filter((r) => L.band(L.score(r)) !== r['Priority band']);
    checks.push({ ok: !bandBad.length, fatal: false, text: bandBad.length ? `Band mismatch: ${bandBad.map((r) => r['Member ID']).join(', ')}` : 'Priority bands match workbook (3 High · 2 Medium)' });
    const tq = raw['Task Queue'];
    checks.push({ ok: tq.length === 5 && tq.every((t) => t['Status'] === 'Open'), fatal: false, text: `Task Queue starts with ${tq.length} tasks, ${tq.filter((t) => t['Status'] === 'Open').length} Open` });
    const noContact = ids.filter((i) => !raw['Contact Directory'].some((c) => c['Member ID'] === i && c['Contact type'] === 'Member'));
    checks.push({ ok: !noContact.length, fatal: false, text: noContact.length ? `No member contact record: ${noContact.join(', ')}` : 'Every member has a Contact Directory record' });
    const need = ['Phone status', 'Medication context', 'Routing recommendation', 'Last permission review', 'Case status'];
    const colMiss = need.filter((c) => !(c in raw['Patient 360'][0]));
    checks.push({ ok: !colMiss.length, fatal: true, text: colMiss.length ? `Patient 360 missing column(s): ${colMiss.join(', ')}` : 'Required Patient 360 columns present' });
    return checks;
  }

  /* ================================================================== shell */
  function renderShell() {
    const openTasks = S.tasks.filter((t) => ACTIVE.includes(t.status)).length;
    $('#topbar').innerHTML = `<div class="in">
      <div class="brand"><div class="mark"><img src="assets/logo.svg" width="32" height="32" alt=""></div><div class="txt"><div class="nm"><b>NEXUS</b> Care Workbench</div><small>Payer Case Management</small></div></div>
      <nav class="tabs" role="tablist" aria-label="Primary">${TABS.map((t) => `<button role="tab" data-act="tab" data-tab="${t.id}" aria-selected="${S.tab === t.id}">${icon(t.icon)}<span class="tl-txt">${t.name}</span>${t.id === 'queue' ? `<span class="cnt">${P.length}</span>` : t.id === 'outreach' ? `<span class="cnt" title="Open tasks">${openTasks}</span>` : ''}</button>`).join('')}</nav>
      <div class="top-right">
        <span class="top-date">${icon('calendar', 'sm')}${fmtDate(CFG.TODAY, true)} · Demo</span>
        <button class="btn-ghost-dark" data-act="reset-demo" title="Restore the workbook starting state">${icon('rotate-ccw', 'sm')}Reset demo</button>
        <div class="user"><div class="avatar">MC</div><div class="u-txt"><div class="u1">${CFG.USER}</div><div class="u2">${CFG.ROLE}</div></div></div>
      </div></div>`;
    const edge = $('#copilot-edge');
    edge.innerHTML = `${icon('sparkles', 'lg')}<span>COPILOT</span>`;
    edge.classList.toggle('open', S.copilot.open);
    edge.setAttribute('aria-expanded', S.copilot.open);
  }

  function pageHead(extra = '') {
    const t = TABS.find((x) => x.id === S.tab);
    return `<div class="page-head"><div><h1>${t.name}</h1><div class="q">${t.q}</div></div><div class="acts">${extra}</div></div>`;
  }

  function memberPills() {
    return `<div class="mpills" role="group" aria-label="Select member">${P.map((m) => `<button class="mpill" data-act="select" data-mid="${m.id}" aria-pressed="${S.sel === m.id}"><span class="mini">${initials(m.name)}</span>${esc(m.name)} <span class="sc">${m.score.toFixed(1)}</span></button>`).join('')}</div>`;
  }

  /* ================================================================== TAB 1 — Today's Queue */
  function filtered() {
    const f = S.f, q = f.q.trim().toLowerCase();
    return P.filter((m) => {
      if (q && !(`${m.name} ${m.id}`.toLowerCase().includes(q))) return false;
      if (f.band && m.band !== f.band) return false;
      if (f.prog && m.raw['Programme'] !== f.prog) return false;
      if (f.cm && m.raw['Case manager'] !== f.cm) return false;
      if (f.status && eff(m) !== f.status) return false;
      if (f.exc && !(contactException(m) || ['REVIEW REQUIRED', 'NOT AUTHORISED'].includes((routeFor(m).target || {}).status))) return false;
      if (f.task) {
        const ts = tasksFor(m.id);
        if (f.task === 'Due today') { if (!ts.some((t) => ACTIVE.includes(t.status) && t.due === CFG.TODAY)) return false; }
        else if (f.task === 'Overdue') { if (!ts.some((t) => ACTIVE.includes(t.status) && dayDiff(t.due) < 0)) return false; }
        else if (!ts.some((t) => t.status === f.task)) return false;
      }
      return true;
    });
  }

  function pageQueue() {
    const high = P.filter((m) => m.band === 'High').length;
    const openTasks = S.tasks.filter((t) => ACTIVE.includes(t.status)).length;
    const exc = P.filter(contactException).length;
    const kpi = (ic, v, l, s, cls = '', kcls = '') => `<div class="kpi ${cls}"><div class="ki ${kcls}">${icon(ic, 'lg')}</div><div><div class="v">${v}</div><div class="l">${l}</div><div class="s">${s}</div></div></div>`;
    const kpis = `<div class="kpis">
      ${kpi('briefcase', CFG.CASELOAD, 'Illustrative caseload', 'Context only — not loaded records', 'dashed', 'dim')}
      ${kpi('users', P.length, 'Sample cases loaded', 'From workbook · Patient 360')}
      ${kpi('zap', high, 'High priority', 'Score ≥ 75')}
      ${kpi('list-todo', openTasks, 'Open tasks', 'Open + in progress, this session')}
      ${kpi('phone-off', exc, 'Contact exceptions', 'Disconnected or unverified member contact', '', exc ? 'crit' : '')}
    </div>`;
    const progs = [...new Set(P.map((m) => m.raw['Programme']))], cms = [...new Set(P.map((m) => m.raw['Case manager']))];
    const statuses = [...new Set(P.map((m) => eff(m)).concat(Object.values(S.caseSim)))];
    const f = S.f, list = filtered();
    const active = f.q || f.band || f.prog || f.cm || f.status || f.task || f.exc;
    const filters = `<div class="filters" role="search">
      <div class="search">${icon('search')}<input class="inp" id="f-q" data-f="q" type="search" placeholder="Search name or member ID" value="${esc(f.q)}" aria-label="Search by member name or ID"></div>
      <div class="seg" role="group" aria-label="Priority">${['', 'High', 'Medium', 'Routine'].map((b) => `<button data-act="band" data-band="${b}" aria-pressed="${f.band === b}">${b || 'All'}</button>`).join('')}</div>
      <select class="inp" data-f="prog" aria-label="Programme">${opt('', f.prog, 'All programmes')}${progs.map((p) => opt(p, f.prog)).join('')}</select>
      <select class="inp" data-f="cm" aria-label="Case manager">${opt('', f.cm, 'All case managers')}${cms.map((p) => opt(p, f.cm)).join('')}</select>
      <select class="inp" data-f="status" aria-label="Case status">${opt('', f.status, 'All case statuses')}${statuses.map((p) => opt(p, f.status)).join('')}</select>
      <select class="inp" data-f="task" aria-label="Task status">${opt('', f.task, 'Any task status')}${['Open', 'In Progress', 'Draft', 'Completed', 'Deferred', 'Due today', 'Overdue'].map((p) => opt(p, f.task)).join('')}</select>
      <label class="toggle"><input type="checkbox" data-f="exc" ${f.exc ? 'checked' : ''}>Contact exceptions</label>
      ${active ? `<button class="btn sm ghost" data-act="reset-filters">${icon('x', 'sm')}Reset filters</button>` : ''}
      <span class="count"><b>${list.length}</b> of ${P.length} cases</span>
    </div>`;
    const rows = list.length ? list.map(queueCard).join('') : `<div class="empty">${icon('search', 'lg')}<p>No cases match these filters.</p><button class="btn sm" data-act="reset-filters">Reset filters</button></div>`;
    return pageHead(`<span class="chip t-muted">${icon('layers')}Sorted by priority score</span>`) + kpis + filters +
      `<div class="queue-grid"><section aria-label="Priority queue">
        <div class="qhead"><div>Score</div><div>Member · why now · next step</div><div>Recommended contact</div><div>Task</div></div>
        ${rows}
        ${note('<b>Illustrative operational work-queue score</b> — not a clinical risk prediction, readmission model or triage tool. Weights and bands are governance hypotheses. Missing data never lowers urgency; it is shown separately. Hard-stop clinical or safeguarding escalations bypass this queue per the plan’s protocol.', 'muted', 'info')}
      </section><aside>${eventFeed()}</aside></div>`;
  }

  function contactSummary(m, rt) {
    const t = rt.target;
    const short = { community: 'Member first', discharged: 'Member first · post-discharge', disconnected: 'Resolve identity, re-confirm scope first', privacy: 'Member-only · safe channel first', inpatient: 'Facility coordination' }[rt.key];
    const fb = rt.fallback ? ` · ${firstName(rt.fallback.name)} = ${rt.fallback.status === 'LIMITED SCOPE' ? 'limited-scope' : 'review'} fallback` : '';
    let extra = '';
    if (rt.key === 'disconnected') extra = `<div class="meta">${icon('phone-off', 'sm')}${esc(firstName(m.name))}’s number disconnected — no retries</div>`;
    if (rt.key === 'privacy') extra = `<div class="meta">${icon('ban', 'sm')}Third-party contact suppressed</div>`;
    return `<div class="nm">${icon(t.role ? 'hospital' : t.type === 'Member' ? 'user-check' : 'users', 'sm')}${esc(t.name)} <span class="rel">· ${esc(t.relationship === 'Self' ? 'Member' : t.relationship)}</span></div>
      <div style="margin-top:4px">${perm(t.status)}</div>
      <div class="meta">${icon('clock', 'sm')}${esc(t.window)}${t.language && t.language !== 'English' && t.language !== '—' ? ` · ${icon('languages', 'sm')}${esc(t.language)}` : ''}</div>
      ${extra}
      <div class="why" title="${esc(rt.why)}">${icon('info', 'sm')} ${esc(short + fb)}</div>`;
  }

  function queueCard(m) {
    const rt = routeFor(m), w = L.whyNow(m.raw, simFor(m.id)), t = primaryTask(m.id), [dl, dt, di] = dueInfo(t);
    const isSim = !!S.caseSim[m.id];
    return `<article class="qcard ${S.sel === m.id ? 'sel' : ''}" data-act="open-member" data-mid="${m.id}" tabindex="0" aria-label="${esc(m.name)}, ${m.band} priority ${m.score.toFixed(1)}. Open Member 360.">
      <div class="q-score">${ring(m.score)}${bandChip(m.band)}</div>
      <div class="q-main">
        <div class="q-name">${esc(m.name)} <span class="id">${m.id}</span>${isSim ? simChip() : ''}</div>
        <div class="q-meta">${icon(progIcon(m.raw['Programme']), 'sm')}${esc(m.raw['Programme'])}<span class="dot"></span>${esc(eff(m))}<span class="dot"></span>${m.raw['Age']} y<span class="dot"></span>CM ${esc(m.raw['Case manager'])}</div>
        <div class="chips" aria-label="Why now">${w.chips.map((c) => chip(c.text, c.tone, c.icon)).join('')}</div>
        <div class="q-next">${icon('corner-down-right', 'sm')}<span><b>Next:</b> ${esc(m.raw['Next best action'])}</span></div>
      </div>
      <div class="q-contact">${contactSummary(m, rt)}</div>
      <div class="q-task"><div>${taskChip(t)}</div><div class="due">${icon(di, 'sm')}<span>${dl}</span>${t ? ` · ${esc(t.owner)}` : ''}</div>
        <div class="acts"><button class="btn sm" data-act="goto" data-tab="outreach" data-mid="${m.id}" title="Prepare outreach">${icon('phone-call', 'sm')}Outreach</button>
        <button class="icon-btn" data-act="override" data-mid="${m.id}" title="Defer or reassign (reason required)" aria-label="Defer or reassign">${icon('ellipsis', 'sm')}</button></div>
      </div>
    </article>`;
  }
  const progIcon = (p) => (/Transitions/.test(p) ? 'hospital' : /Diabetes/.test(p) ? 'activity' : /ED/.test(p) ? 'siren' in IC ? 'siren' : 'activity' : /Maternity/.test(p) ? 'baby' : /Behavioural/.test(p) ? 'brain' : 'heart-pulse');

  function eventFeed() {
    const sims = S.events.slice().reverse().map((e) => {
      const m = M(e.mid);
      return `<div class="feed-item sim"><div class="fi">${icon('bell-ring')}</div><div class="grow"><div class="t1">${esc(e.label)} ${simChip()}</div>
        <div class="t2"><button class="linkish" data-act="open-member" data-mid="${m.id}">${esc(m.name)} · ${m.id}</button> · ${esc(e.source)}</div>
        <div class="t3"><b>Event time</b><span>${esc(e.eventTime)}</span><b>Received</b><span>${esc(e.receivedTime)}</span></div></div></div>`;
    }).join('');
    const wb = P.map((m) => {
      const r = L.src(D, m.id, 'ADT / event'); if (!r) return '';
      const delayed = /delayed/i.test(m.raw['Appointment status']) ? `<div class="t2">${chip('Follow-up feed delayed', 'warn', 'hourglass')}</div>` : '';
      return `<div class="feed-item"><div class="fi">${icon(/discharge/i.test(r['Sample fact']) ? 'hospital' : /ED/.test(r['Sample fact']) ? 'activity' : /maternity/i.test(r['Sample fact']) ? 'baby' : 'clipboard-list')}</div><div class="grow">
        <div class="t1">${esc(r['Sample fact'])}</div>
        <div class="t2"><button class="linkish" data-act="open-member" data-mid="${m.id}">${esc(m.name)} · ${m.id}</button> · ${esc(r['Source'])}</div>
        <div class="t3"><b>Event time</b><span>Not in source</span><b>Received</b><span>Not in source</span><b>Freshness</b><span>${esc(r['Freshness (illustrative)'])} (illustrative) · ${esc(r['Quality flag'])}</span></div>${delayed}</div></div>`;
    }).join('');
    return `<div class="card"><div class="card-h"><div class="hi">${icon('bell-ring')}</div><div><h3>Event feed</h3><div class="hint">Event time and received time kept separate</div></div></div>
      <div class="card-b" style="padding-bottom:6px">
        <div style="background:var(--sim-bg);border:1px dashed var(--sim-line);border-radius:9px;padding:9px;display:grid;gap:7px">
          <select class="inp" data-f2="simTarget" aria-label="Member for simulated event">${P.map((m) => opt(m.id, S.simTarget, `${m.id} · ${m.name}`)).join('')}</select>
          <button class="btn sm" data-act="sim-discharge" style="border-color:var(--sim-line);color:var(--sim);width:100%">${icon('play', 'sm')}Simulate discharge event</button>
          <div class="xs" style="color:#3E2A8C">Demo control — not connected to any hospital or ADT system. Workbook unchanged.</div>
        </div>
        ${sims}${wb}
      </div></div>`;
  }

  /* ================================================================== TAB 2 — Member 360 */
  function pageM360() {
    const m = M(S.sel), raw = m.raw, rt = routeFor(m), w = L.whyNow(raw, simFor(m.id)), status = eff(m), sim = S.caseSim[m.id];
    const ev = simFor(m.id), adt = L.src(D, m.id, 'ADT / event'), apptSrc = L.src(D, m.id, 'Appointments'), medSrc = L.src(D, m.id, 'Medication / pharmacy');
    const ts = tasksFor(m.id), open = ts.filter((t) => ACTIVE.includes(t.status)), pt = primaryTask(m.id), [dl] = dueInfo(pt);
    const toolbar = `<div class="toolbar"><button class="btn sm" data-act="tab" data-tab="queue">${icon('arrow-left', 'sm')}Back to Today's Queue</button>${memberPills()}
      <div class="simbox">${chip('SIMULATION', 'sim', 'flask-conical')}<span class="xs muted">Case status</span><div class="seg" role="group" aria-label="Simulate case status">
      <button data-act="case-sim" data-v="" aria-pressed="${!sim}">Workbook</button>${L.CASE_SIM.map((s) => `<button data-act="case-sim" data-v="${s}" aria-pressed="${sim === s}">${s === 'Inpatient' ? icon('hospital', 'sm') : ''}${s}</button>`).join('')}</div></div></div>`;
    const c = L.contributions(raw);
    const hero = `<div class="card hero"><div class="left"><div class="big-av">${initials(m.name)}</div><div class="grow">
        <h1>${esc(m.name)} <span class="id">${m.id}</span>${bandChip(m.band)}${sim ? simChip() : ''}</h1>
        <div class="meta"><span>${icon('user-round', 'sm')}${raw['Age']} years</span><span>${icon(progIcon(raw['Programme']), 'sm')}${esc(raw['Programme'])}</span><span>${icon('stethoscope', 'sm')}${esc(raw['Conditions'])}</span></div>
        <div class="meta"><span>${icon('activity', 'sm')}Case: <b>${esc(status)}</b>${sim ? ` <span class="xs muted">(workbook: ${esc(raw['Case status'])})</span>` : ''}</span><span>${icon('user-cog', 'sm')}CM ${esc(raw['Case manager'])}</span><span>${icon('languages', 'sm')}${esc(raw['Language'])}</span></div>
        <div class="why"><div class="lbl">Why now · trigger: ${esc(raw['Trigger'])}</div><div class="chips">${w.chips.map((x) => chip(x.text, x.tone, x.icon)).join('')}</div></div>
      </div></div>
      <div class="right">${ring(m.score, true)}<div class="factors">${c.map((x) => `<div class="factor"><span class="fn">${x.factor} <span class="fv">×${(x.weight / 100).toFixed(2)}</span></span><span class="fv">${x.value} → <b>${x.points.toFixed(2)}</b></span><div class="bar"><i style="width:${x.value}%"></i></div></div>`).join('')}</div></div></div>`;
    const tile = (ic, h, v, s, cls = '') => `<div class="tile ${cls}"><div class="th">${icon(ic, 'sm')}${h}</div><div class="tv">${v}</div><div class="ts">${s}</div></div>`;
    const medTone = /conflict/i.test(raw['Medication status']) ? 'crit' : 'warn';
    const apptTone = /visit in/i.test(raw['Appointment status']) ? 'ok' : 'warn';
    const tiles = `<div class="tiles">
      ${tile('bell-ring', 'Latest event', ev ? `${esc(ev.label)} ${simChip()}` : esc(adt ? adt['Sample fact'] : 'Not available in connected data'), ev ? `${esc(ev.source)} · received ${esc(ev.receivedTime)}` : adt ? `${esc(adt['Source'])} · ${esc(adt['Freshness (illustrative)'])} (illustrative)` : '')}
      ${tile('pill', 'Medication', chip(raw['Medication status'], medTone), `${esc(raw['Medication context'])}<br>${medSrc ? esc(medSrc['Source']) + ' · ' + esc(medSrc['Freshness (illustrative)']) : ''}`, medTone)}
      ${tile(apptTone === 'ok' ? 'calendar-check' : 'calendar-x', 'Follow-up', chip(raw['Appointment status'], apptTone), apptSrc ? `${esc(apptSrc['Source'])} · ${esc(apptSrc['Freshness (illustrative)'])}. ‘Not found’ ≠ not scheduled.` : '', apptTone === 'warn' ? 'warn' : '')}
      ${tile('list-todo', 'Tasks', `${open.length} open ${pt ? taskChip(pt) : ''}`, pt ? `${esc(dl)} · ${esc(pt.owner)}` : 'No task on file')}
    </div>`;
    return toolbar + hero + tiles + `<div class="two-col"><div>${contextCard(m)}${timelineCard(m)}</div><div>${routingCard(m, rt)}${trustCard(m)}</div></div>`;
  }

  function contextCard(m) {
    const raw = m.raw, ti = L.trustItems(D, raw), elig = L.src(D, m.id, 'Member & eligibility'), ehr = L.src(D, m.id, 'Clinical / EHR'), adt = L.src(D, m.id, 'ADT / event'), cl = L.src(D, m.id, 'Claims'), lab = L.src(D, m.id, 'Labs & vitals'), sd = L.src(D, m.id, 'SDOH');
    const li = (t, s) => `<li>${esc(t)}${s ? ` <span class="s">— ${esc(s)}</span>` : ''}</li>`;
    const notes = S.notes.filter((n) => n.mid === m.id);
    const grp = (ic, tone, title, items) => `<div class="prov-g"><div class="ph"><span class="chip t-${tone}">${icon(ic)}${title}</span></div><ul>${items.join('') || '<li class="muted">None in connected data</li>'}</ul></div>`;
    const medl = L.medLanes(D, raw, reportedMeds(m.id));
    return `<div class="card"><div class="card-h"><div class="hi">${icon('stethoscope')}</div><div><h3>Clinical & programme context</h3><div class="hint">Every fact keeps its provenance</div></div></div><div class="card-b">
      <div class="prov">
        ${grp('circle-check', 'ok', 'Source-verified / structured', [elig && li(`Member & eligibility ${elig['Quality flag'].toLowerCase()}`, `${elig['Source']} · ${elig['Freshness (illustrative)']}`), ehr && li(raw['Conditions'], `${ehr['Source']} · ${ehr['Quality flag']} · ${ehr['Freshness (illustrative)']}`), adt && li(adt['Sample fact'], `${adt['Source']} · ${adt['Freshness (illustrative)']}`)].filter(Boolean))}
        ${grp('message-square', 'info', 'Member-reported', [sd && li(sd['Sample fact'], `${sd['Source']} · self-reported · ${sd['Freshness (illustrative)']}`), ...notes.map((n) => li(n.summary, `Approved session note · ${n.at} · not source-verified`))].filter(Boolean))}
        ${grp('history', 'muted', 'Historical / delayed', [cl && li(cl['Sample fact'], `${cl['Source']} · ${cl['Quality flag'].toLowerCase()} · ${cl['Freshness (illustrative)']}`), lab && li(lab['Sample fact'], `${lab['Quality flag']} · ${lab['Freshness (illustrative)']}`)].filter(Boolean))}
        ${grp('circle-dashed', 'warn', 'Missing / unconfirmed', ti.filter((i) => ['Missing', 'Not found', 'Unverified', 'Delayed', 'Unreachable'].includes(i.type)).map((i) => li(i.title, i.type)))}
        ${grp('git-compare', 'crit', 'Conflicting — needs human review', ti.filter((i) => ['Conflict', 'Identity'].includes(i.type)).map((i) => li(i.values ? i.values.join('  vs  ') : i.title, i.type)))}
      </div>
      <hr class="div"><div class="row"><div class="sec-label" style="margin:0">Medication — four separate concepts</div><span class="grow"></span>${chip(medl.status, /conflict/i.test(medl.status) ? 'crit' : 'warn')}</div>
      <div class="lanes">${medl.lanes.map((l) => `<div class="lane"><div class="lh">${icon(l.icon, 'sm')}${l.title}</div>${l.items.map((x) => `<div class="li ${/^Not /.test(x) ? 'na' : ''}">${esc(x)}</div>`).join('')}</div>`).join('')}</div>
      <div class="xs muted" style="margin-top:6px">Source: ${esc(medl.source ? medl.source['Source'] + ' · ' + medl.source['Quality flag'] + ' · ' + medl.source['Freshness (illustrative)'] : 'not available')}. An order is not a fill, and neither proves adherence.</div>
    </div></div>`;
  }

  function sessionEvents(mid) {
    return S.events.filter((e) => e.mid === mid).map((e) => ({ label: e.label, dataset: 'Simulated event', source: e.source, eventTime: e.eventTime, receivedTime: e.receivedTime, freshness: 'Just now', quality: 'SIMULATED', action: 'Open / refresh case', sim: true }))
      .concat(S.attempts.filter((a) => a.mid === mid).map((a) => ({ label: `Outreach: ${a.outcome} — ${a.contactName}`, dataset: 'Contact history (session)', source: 'Logged in this demo', eventTime: a.at, receivedTime: a.at, freshness: 'This session', quality: a.thirdParty ? 'Third-party · permission checked' : 'Member contact', action: 'Review draft note' })));
  }

  function timelineCard(m) {
    const rows = L.timeline(D, m.id, sessionEvents(m.id));
    const tone = (q) => (/conflict/i.test(q) ? 'bad' : /delayed|incomplete|stale|varies|exception/i.test(q) ? 'flag' : '');
    return `<div class="card"><div class="card-h"><div class="hi">${icon('history')}</div><div><h3>Event & source timeline</h3><div class="hint">Freshness labels are illustrative — no timestamps invented</div></div></div><div class="card-b tight"><div class="tl">
      ${rows.map((r) => `<div class="tl-row ${r.sim ? 'sim' : tone(r.quality)}"><div class="tl-dot"></div><div>
        <div class="e1">${esc(r.label)} ${r.sim ? simChip() : ''}</div>
        <div class="e2">${esc(r.dataset)} · ${esc(r.source)} · ${r.eventTime ? `event ${esc(r.eventTime)} · received ${esc(r.receivedTime)}` : 'event/received time not in source'}</div>
        <div class="e3">${chip(r.quality, r.sim ? 'sim' : tone(r.quality) === 'bad' ? 'crit' : tone(r.quality) === 'flag' ? 'warn' : 'muted')}<span>${icon('corner-down-right', 'sm')}${esc(r.action)}</span></div>
      </div><div class="fr">${esc(r.freshness)}</div></div>`).join('')}
    </div></div></div>`;
  }

  function contactDetails(t) {
    return `<dl class="rt-grid">
      <dt>Channel</dt><dd>${esc(t.channel)}${t.phone ? ` · ${esc(t.phone)} <span class="muted xs">(fictional)</span>` : ''}</dd>
      <dt>Window</dt><dd>${esc(t.window)}</dd><dt>Language</dt><dd>${esc(t.language)}</dd>
      <dt>Contact type</dt><dd>${esc(t.type)}</dd>
      <dt>Evidence</dt><dd>${esc(t.evidence)}</dd>
      <dt>Permitted scope</dt><dd>${esc(t.scope)}</dd>
      <dt>Restricted</dt><dd>${esc(t.restricted)}</dd>
      ${t.reviewed ? `<dt>Last verified</dt><dd>${fmtDate(t.reviewed, true)} · ${esc(t.verification)}</dd>` : ''}
    </dl>`;
  }

  function routingCard(m, rt) {
    const t = rt.target, sim = S.caseSim[m.id];
    const av = t.role ? `<div class="rt-av role">${icon('hospital')}</div>` : `<div class="rt-av">${initials(t.name)}</div>`;
    let second = '';
    if (rt.key === 'disconnected' && rt.blocked) {
      second = `<div class="rt-alt blocked"><div class="row"><div class="rt-av blocked">${icon('phone-off')}</div><div class="grow"><div class="rt-n">${esc(rt.blocked.name)} <span class="rt-s">· Member</span></div><div class="rt-s">${esc(rt.blocked.phone)} (fictional) · ${esc(rt.blocked.restricted)}</div></div>${perm('DISCONNECTED')}</div></div>`;
    } else if (rt.key === 'privacy') {
      second = `<div class="rt-alt blocked"><div class="row">${icon('ban')}<div class="grow"><b>Third-party contacts suppressed</b><div class="xs">${esc(m.raw['Contact role type'])} · ${esc(m.raw['Authorisation / permission status'])} · ${esc(m.raw['Permitted disclosure scope'])}</div></div>${perm('NOT AUTHORISED')}</div></div>`;
    } else if (rt.key === 'inpatient') {
      second = `<div class="rt-alt"><div class="sec-label">Member</div><div class="xs">${esc(rt.member.name)} — repeated direct calls to an admitted member are not the default.</div><div class="sec-label" style="margin-top:8px">Fallback</div><div class="xs">${esc(rt.fallbackNote)}</div></div>`;
    }
    const alt = rt.fallback && rt.key !== 'inpatient' ? rt.fallback : rt.key === 'inpatient' ? rt.fallback : null;
    const altBlock = alt ? `<div class="rt-alt"><div class="row"><div class="sec-label" style="margin:0">Alternate contact</div><span class="grow"></span>${perm(alt.status)}</div>
      <div class="row" style="margin-top:6px"><div class="rt-av" style="background:var(--royal)">${initials(alt.name)}</div><div class="grow"><div class="rt-n">${esc(alt.name)} <span class="rt-s">· ${esc(alt.relationship)}</span></div><div class="rt-s">${esc(alt.notes)}</div></div></div></div>${contactDetails(alt)}` : '';
    const r = rt.rule;
    const ruleBlock = `<div class="rt-alt"><div class="sec-label">${icon('workflow', 'sm')} Rule applied · ${r ? esc(r['Case / contact condition']) : 'Patient 360 routing recommendation'}</div>
      ${r ? `<div class="xs" style="margin-bottom:4px"><b>Behaviour:</b> ${esc(r['System behaviour'])}</div><div class="xs" style="margin-bottom:4px"><b>Disclosure:</b> ${esc(r['Disclosure control'])}</div><div class="xs"><b>Escalation:</b> ${esc(r['Escalation / next step'])}</div>` : `<div class="xs">${esc(rt.plan)}</div>`}
      <ol class="steps">${rt.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></div>`;
    const dcTask = rt.key === 'inpatient' ? (() => {
      const exists = S.tasks.some((x) => x.mid === m.id && /discharge coordination/i.test(x.title));
      return `<div class="rt-alt" style="background:var(--sim-bg)"><div class="row">${icon('clipboard-list')}<div class="grow"><b>Discharge-coordination task</b><div class="xs">Coordinate transition with the facility discharge planner (from routing rule).</div></div>
        ${exists ? chip('Added as draft', 'sim') : `<button class="btn sm" data-act="add-dc-task" data-mid="${m.id}">${icon('plus', 'sm')}Add as draft</button>`}</div></div>`;
    })() : '';
    return `<div class="card" style="border-color:var(--hl-100)"><div class="card-h"><div class="hi">${icon('users')}</div><div><h3>Contact routing</h3><div class="hint">Who can be contacted, for what, and why</div></div><span class="sp"></span>${chip(eff(m), sim ? 'sim' : 'muted', sim ? 'flask-conical' : 'activity')}</div>
      <div class="route" style="border:0;border-radius:0">
        <div class="rt-top"><div class="sec-label">Recommended target</div><div class="rt-target">${av}<div class="grow"><div class="rt-n">${esc(t.name)}</div><div class="rt-s">${esc(t.relationship === 'Self' ? 'Member (self)' : t.relationship)} · ${esc(t.type)}</div><div style="margin-top:5px">${perm(t.status)}</div></div></div>
        <div class="small" style="margin-top:8px">${esc(rt.why)}</div></div>
        ${contactDetails(t)}${second}${altBlock}${dcTask}${ruleBlock}
        <div class="rt-alt">${note('Emergency-contact status is not permission for routine PHI. Family relationship alone is not legal authority. Disclose the minimum necessary.', 'muted', 'shield-check')}</div>
      </div></div>`;
  }

  function trustCard(m) {
    const items = L.trustItems(D, m.raw);
    return `<div class="card"><div class="card-h"><div class="hi crit">${icon('shield-alert')}</div><div><h3>Data trust & conflicts</h3><div class="hint">Nothing is auto-resolved</div></div><span class="sp"></span>${chip(`${items.filter((i) => i.tone !== 'muted').length} open`, items.some((i) => i.tone === 'crit') ? 'crit' : 'warn')}</div><div class="card-b"><div class="trust">
      ${items.map((i) => `<div class="trust-i ${i.tone}"><div class="ti">${icon(i.icon)}</div><div><div class="tt">${esc(i.title)} ${chip(i.type, i.tone === 'muted' ? 'muted' : i.tone)}</div>
        ${i.values ? `<div class="vs"><div class="v">${esc(i.values[0])}</div><div class="x">VS</div><div class="v">${esc(i.values[1])}</div></div>` : ''}
        <div class="td">${esc(i.detail)}</div>${i.source ? `<div class="tsrc">${icon('database', 'sm')} ${esc(i.source['Source'])} · ${esc(i.source['Quality flag'])} · ${esc(i.source['Freshness (illustrative)'])} → ${esc(i.source['What nurse should do'])}</div>` : ''}</div></div>`).join('')}
    </div></div></div>`;
  }

  /* ================================================================== TAB 3 — Outreach & Notes */
  function contactOptions(m, rt) {
    const o = [];
    if (rt.key === 'inpatient') o.push(rt.target);
    if (rt.member) o.push(rt.member);
    if (!rt.suppressed) rt.alternates.forEach((a) => o.push(a));
    return o;
  }
  function formFor(m, rt) {
    if (!S.form[m.id]) {
      const opts = contactOptions(m, rt).filter((c) => c.status !== 'DISCONNECTED');
      S.form[m.id] = { outcome: 'Connected', contactId: (rt.target && opts.find((c) => c.id === rt.target.id) ? rt.target : opts[0] || {}).id, channel: 'Phone', when: `${CFG.TODAY}T${hhmm()}`,
        reported: '', appointment: '', medication: '', barrier: '', preference: '', followup: '', free: '', dictation: '', confirm: false };
    }
    return S.form[m.id];
  }

  function pageOutreach() {
    const m = M(S.sel), rt = routeFor(m);
    const modeSeg = `<div class="seg" role="group" aria-label="Documentation mode"><button data-act="mode" data-v="manual" aria-pressed="${S.mode === 'manual'}">${icon('pencil', 'sm')}Manual notes</button><button data-act="mode" data-v="scribe" aria-pressed="${S.mode === 'scribe'}">${icon('mic', 'sm')}AI Call Scribe ${chip('Phase 2', 'sim')}</button></div>`;
    return `<div class="toolbar">${memberPills()}<span class="grow"></span>${modeSeg}</div>
      <div class="two-col out"><div>${briefCard(m, rt)}${auditCard(m)}</div><div>${S.mode === 'scribe' ? scribeCard(m, rt) : notesCard(m, rt)}${tasksCard(m)}</div></div>`;
  }

  function briefCard(m, rt) {
    const b = L.callBrief(D, m.raw, rt), t = rt.target, asked = S.asked[m.id] || [];
    return `<div class="card"><div class="card-h"><div class="hi">${icon('clipboard-list')}</div><div><h3>Pre-call brief</h3><div class="hint">${esc(m.name)} · ${m.id} · ${bandChip(m.band)} ${m.score.toFixed(1)}</div></div></div><div class="card-b stack">
      <div><div class="sec-label">Reason for contact</div><div><b>${esc(b.reason)}</b></div><div class="small muted">${esc(b.action)}</div></div>
      <div class="brief-target">${t.role ? `<div class="rt-av role">${icon('hospital')}</div>` : `<div class="rt-av">${initials(t.name)}</div>`}<div class="grow"><div class="rt-n">${esc(t.name)} <span class="rt-s">· ${esc(t.relationship === 'Self' ? 'Member' : t.relationship)}</span></div>
        <div class="xs">${esc(t.scope)}</div><div class="xs muted">${icon('clock', 'sm')} ${esc(t.window)} · ${icon('languages', 'sm')} ${esc(t.language)} · ${esc(t.channel)}</div></div>${perm(t.status)}</div>
      ${b.warn.map((w) => note(esc(w.text), w.tone, w.icon)).join('')}
      <div><div class="sec-label">Unresolved gaps</div><div class="chips">${b.gaps.map((c) => chip(c.text, c.tone, c.icon)).join('')}</div></div>
      <div><div class="sec-label">Suggested coordination questions</div><ul class="qlist">${b.questions.map((q, i) => `<li class="${asked.includes(i) ? 'done' : ''}"><input type="checkbox" data-act="ask" data-i="${i}" ${asked.includes(i) ? 'checked' : ''} aria-label="Mark asked"><span>${esc(q)}</span></li>`).join('')}</ul></div>
      <div><div class="sec-label">Verify before taking action</div><ul class="vlist">${b.verify.map((v) => `<li>${icon('triangle-alert', 'sm')}<span>${esc(v)}</span></li>`).join('')}</ul></div>
      ${note('Coordination only — no diagnosis, medication changes or treatment advice.', 'muted', 'shield-check')}
    </div></div>`;
  }

  function notesCard(m, rt) {
    const f = formFor(m, rt), opts = contactOptions(m, rt), sel = opts.find((c) => c.id === f.contactId) || rt.member;
    const third = sel && sel.type !== 'Member';
    const dr = S.drafts[m.id];
    const fld = (k, label, ph, full) => `<div class="${full ? 'full' : ''}"><label class="f" for="nf-${k}">${label}</label><input class="inp" id="nf-${k}" data-form="${k}" value="${esc(f[k])}" placeholder="${esc(ph)}"></div>`;
    const connected = f.outcome === 'Connected';
    const form = `<div class="form-grid">
      <div><label class="f" for="nf-outcome">Contact outcome</label><select class="inp" id="nf-outcome" data-form="outcome" data-rerender="1">${['Connected', 'No answer', 'Wrong number', 'Member declined', 'Contact unavailable', 'Other'].map((o) => opt(o, f.outcome)).join('')}</select></div>
      <div><label class="f" for="nf-contact">Contacted person</label><select class="inp" id="nf-contact" data-form="contactId" data-rerender="1">${opts.map((c) => `<option value="${c.id}" ${c.id === f.contactId ? 'selected' : ''} ${c.status === 'DISCONNECTED' ? 'disabled' : ''}>${esc(c.name)} — ${esc(c.relationship === 'Self' ? 'Member' : c.relationship)} (${c.status.toLowerCase()})</option>`).join('')}</select></div>
      <div><label class="f" for="nf-channel">Channel</label><select class="inp" id="nf-channel" data-form="channel">${['Phone', 'Secure message / portal', 'Video', 'In person'].map((o) => opt(o, f.channel)).join('')}</select></div>
      <div><label class="f" for="nf-when">Interaction date/time (demo)</label><input class="inp" id="nf-when" type="datetime-local" data-form="when" value="${esc(f.when)}"></div>
      ${third ? `<div class="full">${note(`<b>${esc(sel.name)}</b> (${esc(sel.relationship.toLowerCase()) || 'role'}): ${esc(sel.scope)}. ${esc(sel.restricted)}.`, sel.status === 'REVIEW REQUIRED' ? 'warn' : '', 'scale')}
        <label class="toggle" style="margin-top:6px"><input type="checkbox" data-form="confirm" data-rerender="1" ${f.confirm ? 'checked' : ''}>${sel.role ? 'Role and identity of facility contact verified' : 'Identity verified and permission/scope confirmed as still current'}</label></div>` : ''}
      ${rt.suppressed ? `<div class="full">${note('Only the member can be selected. Third-party contacts are suppressed for this privacy-sensitive case.', 'crit', 'ban')}</div>` : ''}
      ${connected ? `${fld('reported', 'Member-reported update', 'e.g. Feeling about the same since discharge')}${fld('appointment', 'Appointment / referral status', 'e.g. Not yet booked')}
      ${fld('medication', 'Medication access statement', 'What the member says — not verified')}${fld('barrier', 'Social / access barrier', 'e.g. Needs a ride on Tuesday')}
      ${fld('preference', 'Member preference', 'e.g. Mornings, text first')}${fld('followup', 'Follow-up commitment', 'e.g. Call back Monday after PCP booking')}
      <div class="full"><label class="f" for="nf-free">Free-text note</label><textarea class="inp" id="nf-free" data-form="free" rows="2">${esc(f.free)}</textarea></div>` : ''}
      <div class="full"><label class="f" for="nf-dict">${icon('mic-off', 'sm')} Nurse dictation (typed — no microphone access)</label><textarea class="inp" id="nf-dict" data-form="dictation" rows="2" placeholder="Type or paste your own summary…">${esc(f.dictation)}</textarea></div>
    </div>
    <div class="row" style="margin-top:12px"><button class="btn primary" data-act="gen-draft" ${third && !f.confirm ? 'disabled title="Confirm identity and permission first"' : ''}>${icon('sparkles', 'sm')}Generate draft</button>
      <span class="xs muted">Template-based from your entries + workbook context. No external AI, nothing sent.</span></div>`;
    return `<div class="card"><div class="card-h"><div class="hi">${icon('pencil')}</div><div><h3>Notes</h3><div class="hint">Manual notes — works without any recording</div></div><span class="sp"></span>${chip('MVP 1', 'info')}</div>
      <div class="card-b">${form}${dr ? draftReview(m, dr) : ''}</div></div>`;
  }

  function fmtNote(txt) {
    return esc(txt).replace(/\[(MEMBER REPORTED|REPORTED BY [^\]]+)\]/g, '<span class="tag-mr">[$1]</span>').replace(/\[SOURCE RECORD\]/g, '<span class="tag-sv">[SOURCE RECORD]</span>').replace(/\[NEEDS VERIFICATION\]/g, '<span class="tag-nv">[NEEDS VERIFICATION]</span>');
  }
  function secHead(title, ic, st, key, editable) {
    const stc = st === 'approved' ? chip('Approved', 'ok', 'circle-check') : st === 'rejected' ? chip('Rejected', 'muted', 'circle-x') : chip('Draft', 'sim');
    const acts = st === 'pending' || st === 'editing'
      ? `${editable ? (st === 'editing' ? `<button class="btn sm" data-act="draft-save" data-k="${key}">${icon('check', 'sm')}Save edit</button>` : `<button class="btn sm ghost" data-act="draft-edit" data-k="${key}">${icon('pencil', 'sm')}Edit</button>`) : ''}
         <button class="btn sm ghost danger" data-act="draft-reject" data-k="${key}">${icon('x', 'sm')}Reject</button>
         <button class="btn sm ok" data-act="draft-approve" data-k="${key}" ${st === 'editing' ? 'disabled' : ''}>${icon('check', 'sm')}Approve</button>`
      : `<button class="btn sm ghost" data-act="draft-undo" data-k="${key}">${icon('undo-2', 'sm')}Undo</button>`;
    return `<div class="dh">${icon(ic, 'sm')}<b>${title}</b>${stc}<span class="grow"></span>${acts}</div>`;
  }
  function draftReview(m, dr) {
    const st = dr.state;
    const cls = (k) => (st[k] === 'approved' ? 'approved' : st[k] === 'rejected' ? 'rejected' : '');
    return `<hr class="div"><div class="row">${chip('DRAFT — requires nurse approval', 'sim', 'sparkles')}<span class="xs muted">Generated ${esc(dr.at)} · contacted ${esc(dr.contactName)}${dr.thirdParty ? ' (third party, scope-checked)' : ''}</span><span class="grow"></span><button class="btn sm ghost" data-act="draft-discard">${icon('x', 'sm')}Discard draft</button></div>
      <div class="draft-sec ${cls('note')}">${secHead('Contact note', 'file-text', st.note, 'note', true)}<div class="db">${st.note === 'editing' ? `<textarea class="inp" rows="12" id="draft-note-edit">${esc(dr.note)}</textarea>` : `<pre class="note-txt">${fmtNote(dr.note)}</pre>`}</div></div>
      <div class="draft-sec ${cls('assessment')}">${secHead('Assessment update', 'clipboard-check', st.assessment, 'assessment')}<div class="db"><table class="tbl"><tbody>${dr.assessment.map((a) => `<tr><td style="width:150px"><b>${esc(a.domain)}</b></td><td style="width:150px">${chip(a.label, a.label === 'Needs verification' ? 'warn' : 'info')}</td><td>${esc(a.detail)}</td></tr>`).join('')}</tbody></table></div></div>
      <div class="draft-sec ${cls('care')}">${secHead('Care-plan suggestions', 'lightbulb', st.care, 'care')}<div class="db"><ul class="vlist">${dr.care.map((c) => `<li>${icon('chevron-right', 'sm')}<span><b>${esc(c.text)}</b> <span class="muted">— ${esc(c.note)}</span></span></li>`).join('')}</ul><div class="xs muted">Suggestions only. The care plan is not changed unless you approve.</div></div></div>
      <div class="draft-sec"><div class="dh">${icon('list-todo', 'sm')}<b>Proposed tasks</b>${chip(`${dr.tasks.filter((t) => t.state === 'pending').length} pending`, 'sim')}</div><div class="db">
        ${dr.tasks.length ? dr.tasks.map((t, i) => `<div class="ptask">${t.state === 'pending'
          ? `<input class="inp" data-ptask="${i}" data-k="title" value="${esc(t.title)}" aria-label="Task title"><select class="inp" data-ptask="${i}" data-k="owner" aria-label="Owner">${CFG.OWNERS.map((o) => opt(o, t.owner)).join('')}</select><input class="inp" type="date" data-ptask="${i}" data-k="due" value="${esc(t.due)}" aria-label="Due date">
             <div class="row" style="flex-wrap:nowrap"><button class="btn sm ghost danger" data-act="ptask-reject" data-i="${i}" title="Reject">${icon('x', 'sm')}</button><button class="btn sm ok" data-act="ptask-approve" data-i="${i}">${icon('check', 'sm')}Approve</button></div>`
          : `<div><b>${esc(t.title)}</b><div class="xs muted">${esc(t.owner)} · due ${fmtDate(t.due)}</div></div><div></div><div></div>${t.state === 'approved' ? chip('Added to tasks', 'ok', 'circle-check') : chip('Rejected', 'muted')}`}</div>
          <div class="xs muted" style="margin:-2px 0 4px">Evidence: ${esc(t.why)}</div>`).join('') : '<div class="muted small">No tasks proposed.</div>'}
      </div></div>`;
  }

  function scribeCard(m, rt) {
    const sc = S.scribe[m.id] || {}, stages = D['Call AI Workflow'].map((s) => String(s['Stage']).replace(/^\d+\.\s*/, ''));
    const cls = (i) => {
      if (!sc.consent) return i === 0 ? 'done' : i === 1 ? 'now' : 'off';
      if (sc.consent === 'declined') return i === 0 ? 'done' : i === 1 ? 'now' : 'off';
      if (sc.sent) return i <= 7 ? (i === 7 ? 'now' : 'done') : 'off';
      return i <= 6 ? 'done' : i === 7 ? 'now' : 'off';
    };
    const tr = L.syntheticTranscript(m.raw, rt);
    const flags = L.trustItems(D, m.raw).filter((i) => i.tone !== 'muted');
    let body = '';
    if (!sc.consent) {
      body = `<div class="card" style="box-shadow:none"><div class="card-b stack"><div class="row"><b>Consent gate</b><span class="grow"></span><span class="rec"><span class="d"></span>Recording OFF</span></div>
        <table class="tbl"><tbody><tr><td>Jurisdiction / state law</td><td>${chip('Not evaluated — demo', 'muted')}</td></tr><tr><td>Health-plan policy</td><td>${chip('Demo setting only', 'muted')}</td></tr><tr><td>Recording purpose</td><td>Documentation support</td></tr><tr><td>Participant consent</td><td>${chip('Not yet asked', 'warn')}</td></tr></tbody></table>
        <div class="row"><button class="btn" data-act="scribe-consent" data-v="given">${icon('check', 'sm')}Simulate: participant consents</button><button class="btn" data-act="scribe-consent" data-v="declined">${icon('x', 'sm')}Simulate: consent declined</button></div></div></div>`;
    } else if (sc.consent === 'declined') {
      body = note('<b>Recording unavailable / declined.</b> Nothing is captured or transcribed. Continue with manual notes.', 'warn', 'mic-off') +
        `<div class="row" style="margin-top:10px"><button class="btn primary" data-act="mode" data-v="manual">${icon('pencil', 'sm')}Return to manual notes</button><button class="btn ghost" data-act="scribe-reset">Restart simulation</button></div>`;
    } else {
      body = `<div class="row" style="margin-bottom:8px"><span class="rec on"><span class="d"></span>REC (simulated — no audio)</span><span class="xs muted">Synthetic transcript · speaker: ${esc(tr.speaker.name)}</span></div>
        <div class="transcript">${tr.lines.map(([s, x]) => `<p><b>${esc(s)}</b>${esc(x)}</p>`).join('')}</div>
        <div class="sec-label" style="margin-top:12px">Extracted candidates (NLP — simulated)</div>
        <table class="tbl"><tbody>${tr.entities.map((e) => `<tr><td>${esc(e.kind)}</td><td><b>${esc(e.value)}</b></td><td>${chip(e.label, e.label === 'Needs verification' ? 'warn' : 'info')}</td></tr>`).join('')}</tbody></table>
        <div class="sec-label" style="margin-top:12px">Deterministic validation flags</div>
        <div class="chips">${flags.map((f) => chip(f.title, f.tone, f.icon)).join('')}</div>
        <div class="row" style="margin-top:12px">${sc.sent ? chip('Sent to nurse review', 'ok', 'circle-check') : `<button class="btn primary" data-act="scribe-send">${icon('send', 'sm')}Send to nurse review</button>`}<button class="btn ghost" data-act="scribe-reset">Restart simulation</button></div>`;
    }
    return `<div class="card"><div class="card-h"><div class="hi sim">${icon('mic')}</div><div><h3>AI Call Scribe</h3><div class="hint">Consent-gated recording, ASR and drafting</div></div><span class="sp"></span>${chip('PHASE 2 DEMO SIMULATION', 'sim', 'flask-conical')}</div><div class="card-b stack">
      ${note('No microphone access, no call placed, no audio recorded. Shows the future workflow with a synthetic transcript only.', 'sim', 'flask-conical')}
      <div class="stepper">${stages.map((s, i) => `<div class="stp ${cls(i)}"><div class="sn">STEP ${i + 1}</div><div class="st">${esc(s)}</div></div>`).join('')}</div>
      ${body}
      <div class="xs muted">Write-back (step 9) is integration-dependent and never happens in this demo.</div>
    </div></div>`;
  }

  function tasksCard(m) {
    const ts = tasksFor(m.id);
    const acts = (t) => {
      const b = (act, ic, label, cls = 'ghost') => `<button class="btn sm ${cls}" data-act="${act}" data-id="${t.id}">${icon(ic, 'sm')}${label}</button>`;
      const ev = `<button class="icon-btn" data-act="task-evidence" data-id="${t.id}" title="Evidence / rationale" aria-label="View evidence">${icon('eye', 'sm')}</button>`;
      const ed = `<button class="icon-btn" data-act="task-edit" data-id="${t.id}" title="Edit task" aria-label="Edit task">${icon('pencil', 'sm')}</button>`;
      if (t.status === 'Draft') return `${b('task-approve', 'check', 'Approve', 'ok')}${b('task-discard', 'x', 'Discard', 'ghost danger')}${ed}${ev}`;
      if (t.status === 'Open') return `${b('task-start', 'play', 'Start')}${b('task-complete', 'circle-check', 'Complete', 'ok')}${ed}${ev}`;
      if (t.status === 'In Progress') return `${b('task-complete', 'circle-check', 'Complete', 'ok')}${ed}${ev}`;
      return `${b('task-reopen', 'refresh-ccw', 'Reopen')}${ev}`;
    };
    return `<div class="card"><div class="card-h"><div class="hi">${icon('list-todo')}</div><div><h3>Tasks · ${esc(m.name)}</h3><div class="hint">Owner, due date, approval and closure</div></div><span class="sp"></span><button class="btn sm" data-act="task-new" data-mid="${m.id}">${icon('plus', 'sm')}Add draft task</button></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Task</th><th>Owner</th><th>Due</th><th>Status</th><th></th></tr></thead><tbody>
      ${ts.map((t) => { const [dl, dt] = dueInfo(t); return `<tr><td><b>${esc(t.title)}</b><div class="xs muted">${esc(t.id)} · ${esc(t.origin)} · ${esc(t.approval)}</div></td><td>${esc(t.owner)}</td><td>${chip(dl, dt)}</td><td>${taskChip(t)}</td><td><div class="row" style="flex-wrap:nowrap;justify-content:flex-end">${acts(t)}</div></td></tr>`; }).join('') || '<tr><td colspan="5" class="muted">No tasks.</td></tr>'}
      </tbody></table></div></div>`;
  }

  function auditCard(m) {
    const a = S.audit.filter((x) => !x.mid || x.mid === m.id).slice(0, 12);
    return `<div class="card"><div class="card-h"><div class="hi">${icon('history')}</div><div><h3>Audit trail</h3><div class="hint">In-session only · who, what, when, why</div></div><span class="sp"></span>${chip(`${S.audit.length} total`, 'muted')}</div><div class="card-b tight">
      ${a.length ? a.map((x) => `<div class="audit-i"><div class="at">${esc(x.t)}</div><div><b>${esc(x.action)}</b>${x.mid ? ` · ${esc(x.mid)}` : ''}<div class="ad">${esc(x.actor)}${x.detail ? ' · ' + esc(x.detail) : ''}${x.reason ? ` · Reason: “${esc(x.reason)}”` : ''}</div></div></div>`).join('') : `<div class="muted small" style="padding:10px 0">No actions yet for this member. Approvals, overrides, simulations and Copilot drafts appear here.</div>`}
    </div></div>`;
  }

  /* ================================================================== TAB 4 — Insights & Data Trust */
  function pageInsights() {
    const card = (cls, ic, title, hint, body, hiCls = '') => `<div class="card ${cls}"><div class="card-h"><div class="hi ${hiCls}">${icon(ic)}</div><div><h3>${title}</h3>${hint ? `<div class="hint">${hint}</div>` : ''}</div></div><div class="card-b">${body}</div></div>`;
    const stat = (v, l, ic, tone) => `<div class="stat"><div class="sv" ${tone ? `style="color:var(--${tone})"` : ''}>${ic ? icon(ic) : ''}${v}</div><div class="sl">${l}</div></div>`;
    const hbar = (label, v, max, val, dim) => `<div class="hbar" title="${esc(label)}: ${esc(val)}"><span class="hl">${esc(label)}</span><span class="track"><i class="${dim ? 'dim' : ''}" style="width:${max ? (v / max) * 100 : 0}%"></i></span><span class="hv">${val}</span></div>`;

    // A — queue & task pulse
    const bands = ['High', 'Medium', 'Routine'].map((b) => [b, P.filter((m) => m.band === b).length]);
    const by = (s) => S.tasks.filter((t) => t.status === s).length;
    const overdue = S.tasks.filter((t) => ACTIVE.includes(t.status) && dayDiff(t.due) < 0).length;
    const done = S.tasks.filter((t) => t.status === 'Completed'), inWin = done.filter((t) => (t.completedOn || CFG.TODAY) <= t.due).length;
    const owners = CFG.OWNERS.map((o) => [o, S.tasks.filter((t) => t.owner === o && ACTIVE.includes(t.status)).length]);
    const noAction = P.filter((m) => !tasksFor(m.id).some((t) => ACTIVE.includes(t.status) || t.status === 'Draft'));
    const A = `<div class="sec-label">Priority distribution</div><div class="hbars">${bands.map(([b, n]) => hbar(b, n, P.length, `<b>${n}</b> of ${P.length}`, b !== 'High')).join('')}</div>
      <hr class="div"><div class="sec-label">Task status (this session)</div><div class="stat-row">${stat(by('Open'), 'Open')}${stat(by('In Progress'), 'In progress')}${stat(by('Completed'), 'Completed', '', 'ok')}${stat(by('Deferred'), 'Deferred')}${stat(by('Draft'), 'Drafts')}${stat(overdue, 'Overdue', '', overdue ? 'crit' : '')}</div>
      <hr class="div"><div class="row small"><b>Completion within due window:</b> ${done.length ? `${inWin} of ${done.length} completed tasks` : '<span class="muted">No completed tasks yet</span>'}</div>
      <div class="sec-label" style="margin-top:10px">Active tasks by owner</div><div class="hbars">${owners.map(([o, n]) => hbar(o, n, Math.max(1, ...owners.map((x) => x[1])), `<b>${n}</b>`)).join('')}</div>
      <div class="small" style="margin-top:10px">${noAction.length ? `${icon('triangle-alert', 'sm')} No active next action: <b>${noAction.map((m) => esc(m.name)).join(', ')}</b>` : `${icon('circle-check', 'sm')} Every member has an active or draft next action with an owner`}</div>`;

    // B — contact safety
    const disc = P.filter((m) => L.contactStatus(D, m.raw, L.memberContact(D, m.id)) === 'DISCONNECTED').length;
    const unv = P.filter((m) => L.contactStatus(D, m.raw, L.memberContact(D, m.id)) === 'UNVERIFIED').length;
    const noAlt = P.filter((m) => { const r = routeFor(m); return r.suppressed || !r.alternates.length; }).length;
    const limited = P.reduce((n, m) => n + routeFor(m).alternates.filter((a) => a.status === 'LIMITED SCOPE').length, 0);
    const tp = S.attempts.filter((a) => a.thirdParty), tpOk = tp.filter((a) => a.compliant).length;
    const B = `<div class="stat-row">${stat(disc, 'Disconnected member contacts', 'phone-off', disc ? 'crit' : '')}${stat(unv, 'Unverified member contacts', 'lock', unv ? 'crit' : '')}${stat(noAlt, 'No authorised alternate', 'user-x')}${stat(limited, 'Limited-scope alternates', 'scale')}</div>
      <hr class="div"><div class="row small"><b>Third-party route compliance:</b> ${tp.length ? `${tpOk} of ${tp.length} simulated third-party attempts passed the permission check` : '<span class="state-pill">No attempts recorded — not measured</span>'}</div>
      <div class="tbl-wrap" style="margin-top:10px"><table class="tbl"><thead><tr><th>Member</th><th>Member contact</th><th>Alternate</th><th>Permission review</th></tr></thead><tbody>
      ${P.map((m) => { const r = routeFor(m), a = r.alternates[0]; return `<tr><td><b>${m.id}</b> ${esc(m.name)}</td><td>${perm(r.member.status)}</td><td>${a ? `${esc(a.name)} · ${esc(a.relationship)}<br>${perm(a.status)}` : `<span class="muted">None on file</span>`}</td><td>${/^\d{4}/.test(m.raw['Last permission review']) ? fmtDate(m.raw['Last permission review'], true) : chip(m.raw['Last permission review'], 'warn')}</td></tr>`; }).join('')}
      </tbody></table></div>`;

    // C — freshness & conflicts
    const allTrust = P.flatMap((m) => L.trustItems(D, m.raw).map((i) => ({ ...i, mid: m.id })));
    const cnt = (types) => allTrust.filter((i) => types.includes(i.type)).length;
    const datasets = [...new Set(D['Source Records'].map((s) => s['Dataset']))];
    const tone = (q) => (/conflict/i.test(q) ? 'crit' : /delayed|incomplete|stale|exception|varies/i.test(q) ? 'warn' : '');
    const C = `<div class="stat-row" style="margin-bottom:12px">${stat(cnt(['Conflict']), 'Data conflicts', 'git-compare', 'crit')}${stat(cnt(['Identity']), 'Identity exceptions', 'fingerprint', 'crit')}${stat(cnt(['Delayed']), 'Delayed feeds', 'hourglass')}${stat(cnt(['Missing', 'Not found']), 'Missing / not found', 'file-question')}${stat(cnt(['Unverified', 'Unreachable']), 'Unverified / unreachable', 'lock')}${stat(cnt(['Stale']), 'SDOH to reconfirm', 'history')}</div>
      <div class="tbl-wrap"><table class="tbl matrix"><thead><tr><th>Dataset</th>${P.map((m) => `<th>${m.id}</th>`).join('')}</tr></thead><tbody>
      ${datasets.map((ds) => `<tr><td><b>${esc(ds)}</b></td>${P.map((m) => { const s = L.src(D, m.id, ds); return `<td class="cell">${s ? `<span class="cellv ${tone(s['Quality flag'])}" title="${esc(s['Source'])} · ${esc(s['Quality flag'])} · ${esc(s['Sample fact'])}">${tone(s['Quality flag']) === 'crit' ? icon('git-compare', 'sm') : tone(s['Quality flag']) ? icon('triangle-alert', 'sm') : ''}${esc(String(s['Freshness (illustrative)']).replace(' simulated', ''))}</span>` : '—'}</td>`; }).join('')}</tr>`).join('')}
      </tbody></table></div>
      <div class="xs muted" style="margin-top:8px">Freshness labels and quality flags from Source Records (illustrative). Hover a cell for source and flag. Claims are delayed historical context, never a real-time trigger.</div>`;

    // D — AI quality & oversight
    const st = S.stats, k = (n) => D['KPI Definitions'].find((x) => x['Metric'] === n) || {};
    const aiRows = [
      ['AI draft acceptance', 'Not measured — requires reviewed draft sample', `${st.drafts} draft${st.drafts === 1 ? '' : 's'} · ${st.approved} sections approved · ${st.rejected} rejected`],
      ['Call transcription consent capture rate', 'Demo simulation only', `${st.consentGiven} consented · ${st.consentDeclined} declined (simulated)`],
      ['ASR critical-field accuracy', 'Not measured — Phase 2 validation required', 'No audio in prototype'],
      ['AI note material correction rate', 'Baseline pending', `${st.edited} note edits this session`],
      ['Copilot grounded answer rate', 'Manual QA / demo only', `${st.cpGrounded} of ${st.cpTotal} answers carried source evidence`],
      ['Authorised contact route compliance', tp.length ? 'Session count' : 'No attempts recorded', tp.length ? `${tpOk} / ${tp.length} third-party attempts` : '—'],
      ['Contact reachability rate', 'Baseline pending', `${S.attempts.filter((a) => a.outcome === 'Connected').length} connected of ${S.attempts.length} logged attempts`],
      ['Nurse overrides / deferrals', 'Session count', `${S.overrides} this session`],
    ];
    const Dd = `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Metric</th><th>Prototype state</th><th>This session</th></tr></thead><tbody>
      ${aiRows.map(([n, s, v]) => `<tr><td><b>${esc(n)}</b><div class="xs muted">${esc(k(n)['Definition'] || 'Count of in-session nurse actions')}</div></td><td><span class="state-pill ${s === 'Session count' ? 'real' : ''}">${esc(s)}</span></td><td class="small">${esc(v)}</td></tr>`).join('')}
      </tbody></table></div>`;

    // E — time allocation (discovery hypothesis)
    const alloc = [['Patient-facing care & coordination', 180], ['Data search & reconciliation', 120], ['Documentation & assessments', 90], ['Outreach & tracking', 60], ['Task administration', 30]];
    const E = `${note('<b>Illustrative working-day allocation — discovery hypothesis, not measured caselet data.</b> Not a benchmark or baseline; not from app telemetry.', 'warn', 'lightbulb')}
      <div class="hbars" style="margin-top:12px">${alloc.map(([l, v], i) => hbar(l, v, 180, `<b>${v}</b> min · ${(v / 480 * 100).toFixed(2)}%`, i !== 0)).join('')}</div>
      <div class="xs muted" style="margin-top:8px">Total 480 minutes = 100.00%. Highlighted bar: time with patients; lighter bars: hypothesised overhead NEXUS targets.</div>`;

    // F — pilot KPIs
    const F = `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Metric</th><th>Definition</th><th>Proposed target</th><th>Current</th></tr></thead><tbody>
      ${D['KPI Definitions'].filter((x) => !/AI quality|Safety|Privacy/.test(x['Type']) && x['Metric'] !== 'Contact reachability rate').concat(D['KPI Definitions'].filter((x) => x['Metric'] === 'Copilot grounded answer rate'))
        .map((x) => `<tr><td><b>${esc(x['Metric'])}</b><div class="xs muted">${esc(x['Type'])}</div></td><td class="small">${esc(x['Definition'])}</td><td>${chip(x['Proposed target'], 'info')}<div class="xs muted" style="margin-top:3px">Hypothesis</div></td><td><span class="state-pill">Baseline pending</span></td></tr>`).join('')}
      </tbody></table></div><div class="xs muted" style="margin-top:8px">Targets are pilot hypotheses, not results. Outreach timing follows each programme’s rules — the two-business-day target is not universal.</div>`;

    // G — risks + validation
    const G = `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Risk</th><th>Severity</th><th>Safeguard in NEXUS</th></tr></thead><tbody>
      ${D['Risks'].map((r) => `<tr><td><b>${esc(r['Risk'])}</b><div class="xs muted">${esc(r['Failure mode'])}</div></td><td>${chip(r['Severity'], r['Severity'] === 'High' ? 'crit' : 'warn')}</td><td class="small">${esc(r['Mitigation'])}</td></tr>`).join('')}
      </tbody></table></div>`;
    const V = CHECKS.map((c) => `<div class="check-i ${c.ok ? '' : 'fail'}">${icon(c.ok ? 'circle-check' : 'circle-x')}<span>${esc(c.text)}</span></div>`).join('') +
      `<div class="xs muted" style="margin-top:8px">Source: ${esc(D._meta ? D._meta.workbook : 'workbook')}${D._meta ? ` · sha256 ${esc(D._meta.sha256)}…` : ''} · session edits never modify it.</div>`;

    return pageHead(`<span class="chip t-muted">${icon('database')}Counts from workbook + this session</span>`) + `<div class="ins-grid">
      ${card('c7', 'gauge', 'Queue & task pulse', 'Live from the 5 demo members and session task state', A)}
      ${card('c5', 'users', 'Contact safety & reachability', 'From Contact Directory and routing rules', B)}
      ${card('c12', 'database', 'Source freshness & data conflicts', 'Rows: datasets · columns: members', C)}
      ${card('c7', 'bot', 'AI quality & human oversight', 'No invented percentages', Dd)}
      ${card('c5', 'clock', 'Working-day time allocation', 'Discovery hypothesis', E)}
      ${card('c8', 'chart-column', 'Pilot KPIs & proposed targets', 'From KPI Definitions', F)}
      ${card('c4', 'shield-check', 'Data validation on load', 'Workbook checks', V)}
      ${card('c12', 'shield-alert', 'Risks & safeguards', 'From Risks sheet', G, 'crit')}
    </div>`;
  }

  /* ================================================================== Copilot */
  function cpCtx() {
    return { member: S.sel ? M(S.sel).raw : null, simFor, statusFor: (raw) => S.caseSim[raw['Member ID']] || raw['Case status'], reportedMeds, today: CFG.TODAY };
  }
  function cpPrompts() {
    const m = M(S.sel), f = firstName(m.name), out = [`Why is ${m.id} ${m.band} priority today?`, `Summarise ${f}’s recent events and outstanding gaps.`, `Who can I contact for ${m.id}?`];
    if (/conflict/i.test(m.raw['Medication status'])) out.push('Which medication records conflict?');
    if (/disconnected/i.test(m.raw['Phone status'])) out.push(`Why should I not call ${f}’s number again?`);
    out.push(`Prepare a call brief for ${f}.`);
    if (/transport/i.test(m.raw['SDOH context'])) out.push(`Draft a task to confirm transport support for ${m.id}.`);
    out.push('What does ‘not found’ mean for appointment data?', 'What changes when a member is inpatient?');
    return out.slice(0, 7);
  }
  function renderBlock(b) {
    if (b.p) return `<p>${esc(b.p)}</p>`;
    if (b.list) return `<ul>${b.list.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
    if (b.kv) return `<dl class="kv">${b.kv.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
    if (b.warn) return note(esc(b.warn), 'crit', 'shield-alert');
    if (b.note) return note(esc(b.note), 'muted', 'info');
    if (b.bars) return `<div class="factors" style="margin:8px 0">${b.bars.map((x) => `<div class="factor"><span class="fn">${x.factor} (${x.weight}%)</span><span class="fv">${x.value} → <b>${x.points.toFixed(2)} pts</b></span><div class="bar"><i style="width:${x.value}%"></i></div></div>`).join('')}</div>`;
    if (b.route) { const r = b.route, t = r.target; return `<div class="brief-target" style="margin:6px 0">${t.role ? `<div class="rt-av role">${icon('hospital')}</div>` : `<div class="rt-av">${initials(t.name)}</div>`}<div class="grow"><b>${esc(t.name)}</b><div class="xs">${esc(t.scope)}</div></div>${perm(t.status)}</div>${r.fallback ? `<div class="xs"><b>Fallback:</b> ${esc(r.fallbackNote)}</div>` : `<div class="xs"><b>Fallback:</b> ${esc(r.fallbackNote || 'None')}</div>`}`; }
    if (b.labelled) return `<ul style="list-style:none;padding:0">${b.labelled.map(([l, t]) => `<li style="margin:4px 0">${chip(l, l === 'Source record' ? 'ok' : l === 'Self-reported' ? 'info' : 'warn')} ${esc(t)}</li>`).join('')}</ul>`;
    return '';
  }
  function renderCopilot() {
    const el = $('#copilot'), m = M(S.sel), tab = TABS.find((t) => t.id === S.tab);
    el.classList.toggle('open', S.copilot.open);
    el.setAttribute('aria-hidden', !S.copilot.open);
    if (!S.copilot.open) { el.innerHTML = ''; return; }
    const msgs = S.copilot.msgs.map((x) => x.u ? `<div class="msg-u">${esc(x.u)}</div>` : `<div class="msg-a"><h4>${icon('sparkles', 'sm')}${esc(x.a.title)}</h4>${x.a.blocks.map(renderBlock).join('')}
      ${x.a.actions.map((a, i) => `<button class="btn sm ${a.act === 'draftTask' ? 'primary' : ''}" style="margin:4px 6px 0 0" data-act="cp-action" data-m="${x.id}" data-i="${i}" ${x.done && x.done.includes(i) ? 'disabled' : ''}>${icon(a.act === 'draftTask' ? 'plus' : 'arrow-right', 'sm')}${esc(x.done && x.done.includes(i) ? 'Draft added' : a.label)}</button>`).join('')}
      ${x.a.evidence.length ? `<details class="ev" open><summary>SOURCES (${x.a.evidence.length})</summary>${x.a.evidence.map((e) => `<div>${icon('database', 'sm')} <b>${esc(e.label)}</b> — ${esc(e.detail)}</div>`).join('')}</details>` : '<div class="ev xs muted">No member evidence — answer withheld.</div>'}</div>`).join('');
    const welcome = `<div class="welcome"><p>I answer from <b>${esc(m.name)}</b>’s connected demo record, contact permissions and approved workflow rules — with sources.</p>
      <div class="gr"><div>${icon('circle-check', 'sm')}Explain scores, summarise, show conflicts, draft briefs and tasks for your review</div><div>${icon('ban', 'sm')}No diagnosis, prescribing, dose choices, triage or contacting anyone</div></div></div>`;
    el.innerHTML = `<div class="dr-h"><div class="ai">${icon('sparkles')}</div><div><div class="t1">NEXUS Copilot</div><div class="t2">Read-only · grounded in demo data · MVP-lite</div></div><button class="icon-btn" data-act="copilot-close" aria-label="Close Copilot">${icon('x')}</button></div>
      <div class="dr-ctx">${chip(tab.name, 'muted', tab.icon)}${chip(`${m.name} · ${m.id}`, 'info', 'user-round')}${chip(CFG.ROLE, 'muted', 'user-cog')}${chip(eff(m), S.caseSim[m.id] ? 'sim' : 'muted', 'activity')}</div>
      <div class="dr-body" id="cp-body">${msgs || welcome}</div>
      <div class="dr-foot"><div class="prompts ${S.copilot.msgs.length ? 'compact' : ''}">${cpPrompts().map((p) => `<button class="prompt" data-act="cp-ask" data-q="${esc(p)}">${esc(p)}</button>`).join('')}</div>
        <form class="ask" data-act-submit="cp"><input class="inp" id="cp-input" placeholder="Ask about ${esc(firstName(m.name))}…" autocomplete="off" aria-label="Ask Copilot"><button class="btn primary" type="submit" aria-label="Send">${icon('send', 'sm')}</button></form>
        <div class="xs muted" style="margin-top:6px">Local rules + templates. No external model; nothing leaves this browser.</div></div>`;
    const body = $('#cp-body'); if (body) body.scrollTop = body.scrollHeight;
  }
  function cpAsk(q) {
    if (!q.trim()) return;
    const a = L.copilot(D, q, cpCtx());
    const id = S.seq++;
    S.copilot.msgs.push({ u: q }, { id, a, done: [] });
    S.stats.cpTotal++; if (a.evidence.length) S.stats.cpGrounded++;
    save(); renderCopilot();
  }

  /* ================================================================== modal + toast */
  function openModal({ title, ic = 'info', body, ok = 'Confirm', onOk }) {
    modalCb = onOk;
    $('#modal-root').innerHTML = `<div class="modal-bg" data-act="modal-cancel"><div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}" data-stop="1"><div class="mh">${icon(ic)}${esc(title)}</div><form class="mb" id="modal-form" data-act-submit="modal">${body}</form>
      <div class="mf"><button class="btn" data-act="modal-cancel">Cancel</button>${ok ? `<button class="btn primary" data-act="modal-ok">${esc(ok)}</button>` : ''}</div></div></div>`;
    const first = $('#modal-root input, #modal-root select, #modal-root textarea'); if (first) first.focus();
  }
  function closeModal() { $('#modal-root').innerHTML = ''; modalCb = null; }
  function modalSubmit() {
    const form = $('#modal-form'); if (!form) return closeModal();
    const data = Object.fromEntries(new FormData(form).entries());
    const req = form.querySelector('[required]');
    if (req && !String(data[req.name] || '').trim()) { req.focus(); req.style.borderColor = 'var(--crit)'; return; }
    const cb = modalCb; closeModal(); if (cb) cb(data);
  }
  let toastT;
  function toast(msg, ic = 'circle-check') { const t = $('#toast'); t.innerHTML = `${icon(ic)}<span>${esc(msg)}</span>`; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2800); }

  /* ================================================================== actions */
  const newTaskId = (mid) => `T-${mid.slice(3)}-S${pad(S.seq++)}`;
  function addTask(mid, t, status, origin, approval) {
    const m = M(mid);
    const task = { id: newTaskId(mid), mid, priority: m.band, title: t.title, status, due: t.due, owner: t.owner, approval, evidence: t.why || t.evidence || '', origin };
    S.tasks.push(task); return task;
  }
  const findTask = (id) => S.tasks.find((t) => t.id === id);
  function reasonModal(title, ic, extra, cb) {
    openModal({ title, ic, body: `${extra || ''}<div><label class="f" for="m-reason">Reason (required — recorded in audit trail)</label><textarea class="inp" id="m-reason" name="reason" rows="3" required></textarea></div>`, ok: 'Save', onOk: cb });
  }

  const ACTIONS = {
    tab: (el) => { S.tab = el.dataset.tab; window.scrollTo(0, 0); },
    goto: (el) => { if (el.dataset.mid) S.sel = el.dataset.mid; S.tab = el.dataset.tab; window.scrollTo(0, 0); },
    select: (el) => { S.sel = el.dataset.mid; },
    'open-member': (el) => { S.sel = el.dataset.mid; S.tab = 'm360'; window.scrollTo(0, 0); },
    band: (el) => { S.f.band = el.dataset.band; },
    'reset-filters': () => { S.f = { q: '', band: '', prog: '', cm: '', status: '', task: '', exc: false }; },
    'reset-demo': () => openModal({ title: 'Reset demo?', ic: 'rotate-ccw', body: '<p class="small">Restores the workbook starting state and clears all simulated events, case-status simulations, drafts, task changes, notes, Copilot history and the audit trail.</p>', ok: 'Reset demo',
      onOk: () => { const open = S.copilot.open; S = freshState(); S.copilot.open = open; save(); render(); toast('Demo reset to workbook state', 'rotate-ccw'); } }),
    'sim-discharge': () => {
      const mid = S.simTarget, m = M(mid), t = stamp();
      S.events.push({ id: S.seq++, mid, kind: 'discharge', label: 'Hospital discharge event', eventTime: t, receivedTime: t, source: 'Demo simulator — not a real ADT feed' });
      log('Simulated discharge event', mid, 'Added to in-memory event feed; workbook unchanged');
      toast(`Simulated discharge event added for ${m.name}`, 'bell-ring');
    },
    'case-sim': (el) => {
      const v = el.dataset.v, m = M(S.sel);
      if (v) S.caseSim[m.id] = v; else delete S.caseSim[m.id];
      log(v ? `Simulated case status → ${v}` : 'Cleared case-status simulation', m.id, 'Display state only');
      if (v === 'Inpatient') toast('Inpatient: routing switched to facility discharge planner', 'hospital');
    },
    'add-dc-task': (el) => {
      const mid = el.dataset.mid;
      addTask(mid, { title: 'Discharge coordination with hospital care coordinator / discharge planner', owner: M(mid).raw['Case manager'], due: CFG.TODAY, why: 'Contact Routing Rules · Member is in an inpatient facility (simulated)' }, 'Draft', 'Simulation · routing rule', 'Pending nurse approval');
      log('Draft task created', mid, 'Discharge coordination (inpatient simulation)');
      toast('Draft task added — approve it in Outreach & Notes', 'clipboard-list');
    },
    override: (el) => {
      const mid = el.dataset.mid, m = M(mid), t = primaryTask(mid);
      openModal({ title: `Defer or reassign · ${m.name}`, ic: 'user-cog', ok: 'Save',
        body: `<div><label class="f">Action</label><select class="inp" name="action"><option>Defer</option><option>Reassign</option></select></div>
          <div><label class="f">Reassign to (if reassigning)</label><select class="inp" name="owner">${CFG.OWNERS.map((o) => opt(o, t ? t.owner : '')).join('')}</select></div>
          <div><label class="f" for="m-reason">Reason (required)</label><textarea class="inp" id="m-reason" name="reason" rows="3" required></textarea></div>
          <div class="xs muted">The priority score itself is not changed. ${t ? `Applies to task ${esc(t.id)}.` : ''}</div>`,
        onOk: (d) => {
          if (!t) return;
          if (d.action === 'Defer') { t.status = 'Deferred'; } else { t.owner = d.owner; }
          S.overrides++;
          log(d.action === 'Defer' ? 'Queue item deferred' : `Reassigned to ${d.owner}`, mid, t.id, d.reason);
          save(); render(); toast(d.action === 'Defer' ? 'Deferred — recorded in audit trail' : `Reassigned to ${d.owner}`);
        } });
      return false;
    },
    mode: (el) => { S.mode = el.dataset.v; },
    ask: (el) => { const a = S.asked[S.sel] || (S.asked[S.sel] = []), i = Number(el.dataset.i); const k = a.indexOf(i); if (k >= 0) a.splice(k, 1); else a.push(i); },
    'gen-draft': () => {
      const m = M(S.sel), rt = routeFor(m), f = formFor(m, rt);
      const opts = contactOptions(m, rt), sel = opts.find((c) => c.id === f.contactId) || rt.member;
      if (sel.type !== 'Member' && !f.confirm) { toast('Confirm identity and permission first', 'triangle-alert'); return false; }
      const when = (f.when || '').replace('T', ' ');
      const d = L.draftNote(D, m.raw, rt, { ...f, when }, CFG.TODAY);
      S.drafts[m.id] = { ...d, at: hhmm(), contactName: sel.name, form: { ...f }, state: { note: 'pending', assessment: 'pending', care: 'pending' }, tasks: d.tasks.map((t) => ({ ...t, state: 'pending' })) };
      S.attempts.push({ mid: m.id, contactId: sel.id, contactName: sel.name, thirdParty: sel.type !== 'Member', compliant: sel.type === 'Member' || (f.confirm && !rt.suppressed && sel.status !== 'NOT AUTHORISED'), outcome: f.outcome, at: stamp() });
      S.stats.drafts++;
      log('Contact attempt logged', m.id, `${f.outcome} · ${sel.name}${sel.type !== 'Member' ? ' (third party, scope confirmed)' : ''}`);
      log('Draft generated (template-based)', m.id, 'Note, assessment, care-plan suggestions, tasks — pending review');
    },
    'draft-discard': () => { delete S.drafts[S.sel]; log('Draft discarded', S.sel); },
    'draft-edit': (el) => { S.drafts[S.sel].state[el.dataset.k] = 'editing'; },
    'draft-save': (el) => { const dr = S.drafts[S.sel], ta = $('#draft-note-edit'); if (ta) dr.note = ta.value; dr.state[el.dataset.k] = 'pending'; S.stats.edited++; log('Draft note edited', S.sel); },
    'draft-approve': (el) => {
      const k = el.dataset.k, dr = S.drafts[S.sel]; dr.state[k] = 'approved'; S.stats.approved++;
      if (k === 'note') {
        const f = dr.form;
        S.notes.push({ mid: S.sel, at: stamp(), text: dr.note, medication: dr.connected && f.medication ? f.medication.trim() : '', summary: [f.reported, f.appointment, f.barrier].filter((x) => x && x.trim()).join('; ') || `${f.outcome} — ${dr.contactName}` });
      }
      log(`Approved ${k === 'note' ? 'contact note' : k === 'care' ? 'care-plan suggestions' : 'assessment update'}`, S.sel, 'Stored in demo session only — no write-back');
      toast('Approved — stored in this demo session only');
    },
    'draft-reject': (el) => { const k = el.dataset.k; S.drafts[S.sel].state[k] = 'rejected'; S.stats.rejected++; log(`Rejected draft ${k}`, S.sel); },
    'draft-undo': (el) => { const k = el.dataset.k; S.drafts[S.sel].state[k] = 'pending'; if (k === 'note') { const i = S.notes.map((n) => n.mid).lastIndexOf(S.sel); if (i >= 0) S.notes.splice(i, 1); } log(`Reverted ${k} to draft`, S.sel); },
    'ptask-approve': (el) => {
      const dr = S.drafts[S.sel], t = dr.tasks[Number(el.dataset.i)];
      const task = addTask(S.sel, t, 'Open', 'Outreach draft', `Approved by ${CFG.USER}`);
      t.state = 'approved'; S.stats.approved++;
      log('Task approved', S.sel, `${task.id} · ${task.title} · ${task.owner} · due ${task.due}`);
      toast('Task approved and added');
    },
    'ptask-reject': (el) => { const dr = S.drafts[S.sel]; dr.tasks[Number(el.dataset.i)].state = 'rejected'; S.stats.rejected++; log('Proposed task rejected', S.sel); },
    'task-approve': (el) => { const t = findTask(el.dataset.id); t.status = 'Open'; t.approval = `Approved by ${CFG.USER}`; log('Task approved', t.mid, `${t.id} · ${t.title}`); },
    'task-discard': (el) => { const t = findTask(el.dataset.id); S.tasks = S.tasks.filter((x) => x !== t); log('Draft task discarded', t.mid, t.title); },
    'task-start': (el) => { const t = findTask(el.dataset.id); t.status = 'In Progress'; log('Task started', t.mid, t.id); },
    'task-complete': (el) => { const t = findTask(el.dataset.id); t.status = 'Completed'; t.completedOn = CFG.TODAY; log('Task completed', t.mid, t.id); toast('Task marked complete'); },
    'task-reopen': (el) => { const t = findTask(el.dataset.id); reasonModal(`Reopen ${t.id}`, 'refresh-ccw', '', (d) => { t.status = 'Open'; delete t.completedOn; log('Task reopened', t.mid, t.id, d.reason); save(); render(); }); return false; },
    'task-edit': (el) => {
      const t = findTask(el.dataset.id);
      openModal({ title: `Edit ${t.id}`, ic: 'pencil', ok: 'Save', body: `<div><label class="f">Title</label><input class="inp" name="title" value="${esc(t.title)}" required></div>
        <div class="form-grid"><div><label class="f">Owner</label><select class="inp" name="owner">${CFG.OWNERS.map((o) => opt(o, t.owner)).join('')}</select></div><div><label class="f">Due date</label><input class="inp" type="date" name="due" value="${esc(t.due)}"></div></div>`,
        onOk: (d) => { const ch = ['title', 'owner', 'due'].filter((k) => d[k] && d[k] !== t[k]); ch.forEach((k) => (t[k] = d[k])); if (ch.length) log('Task edited', t.mid, `${t.id} · ${ch.join(', ')}`); save(); render(); } });
      return false;
    },
    'task-evidence': (el) => {
      const t = findTask(el.dataset.id);
      openModal({ title: `Evidence · ${t.id}`, ic: 'eye', ok: '', body: `<dl class="rt-grid" style="padding:0;border:0"><dt>Task</dt><dd>${esc(t.title)}</dd><dt>Member</dt><dd>${esc(t.mid)} · ${esc(M(t.mid).name)}</dd><dt>Rationale</dt><dd>${esc(t.evidence)}</dd><dt>Origin</dt><dd>${esc(t.origin)}</dd><dt>Approval</dt><dd>${esc(t.approval)}</dd><dt>Owner / due</dt><dd>${esc(t.owner)} · ${fmtDate(t.due, true)}</dd></dl>` });
      return false;
    },
    'task-new': (el) => {
      const mid = el.dataset.mid;
      openModal({ title: `New draft task · ${M(mid).name}`, ic: 'plus', ok: 'Add draft', body: `<div><label class="f">Title</label><input class="inp" name="title" required></div>
        <div class="form-grid"><div><label class="f">Owner</label><select class="inp" name="owner">${CFG.OWNERS.map((o) => opt(o, M(mid).raw['Case manager'])).join('')}</select></div><div><label class="f">Due date</label><input class="inp" type="date" name="due" value="${L.addDays(CFG.TODAY, 1)}"></div></div>
        <div><label class="f">Evidence / rationale</label><input class="inp" name="why"></div>`,
        onOk: (d) => { const t = addTask(mid, d, 'Draft', 'Manual draft', 'Pending nurse approval'); log('Draft task created', mid, t.title); save(); render(); } });
      return false;
    },
    'scribe-consent': (el) => { const v = el.dataset.v; S.scribe[S.sel] = { consent: v }; S.stats[v === 'given' ? 'consentGiven' : 'consentDeclined']++; log(`Scribe consent simulated: ${v}`, S.sel, 'Phase 2 simulation — no audio'); },
    'scribe-reset': () => { delete S.scribe[S.sel]; },
    'scribe-send': () => {
      const m = M(S.sel), rt = routeFor(m), tr = L.syntheticTranscript(m.raw, rt), f = formFor(m, rt);
      const e = Object.fromEntries(tr.entities.map((x) => [x.kind, x.value]));
      Object.assign(f, { outcome: 'Connected', contactId: tr.speaker.id, appointment: e['Appointment status'] || '', barrier: e['Barrier'] || '', preference: e['Contact preference'] || '', followup: e['Commitment'] || '', dictation: 'Populated from simulated Scribe transcript — review every field.', confirm: tr.speaker.type === 'Member' ? f.confirm : true });
      S.scribe[S.sel].sent = true; S.mode = 'manual';
      ACTIONS['gen-draft']();
      log('Scribe output sent to nurse review', m.id, 'Synthetic transcript → draft');
      toast('Scribe draft ready for your review', 'sparkles');
    },
    'copilot-open': () => { S.copilot.open = true; setTimeout(() => { const i = $('#cp-input'); if (i) i.focus(); }, 220); },
    'copilot-close': () => { S.copilot.open = false; },
    'cp-ask': (el) => { cpAsk(el.dataset.q); return false; },
    'cp-action': (el) => {
      const msg = S.copilot.msgs.find((x) => x.id === Number(el.dataset.m)), a = msg.a.actions[Number(el.dataset.i)];
      if (a.act === 'draftTask') {
        const t = addTask(a.payload.mid, a.payload, 'Draft', 'Copilot draft', 'Pending nurse approval');
        msg.done.push(Number(el.dataset.i));
        log('Copilot draft task created', a.payload.mid, `${t.id} · ${t.title} — not dispatched`);
        toast('Draft task added — approve it in Outreach & Notes', 'clipboard-list');
      } else if (a.act === 'goto') { S.sel = a.payload.mid; S.tab = a.payload.tab; }
    },
    'modal-ok': () => { modalSubmit(); return false; },
    'modal-cancel': () => { closeModal(); return false; },
  };

  /* ================================================================== render + events */
  function render() {
    const ae = document.activeElement, fid = ae && ae.id, pos = ae && 'selectionStart' in ae ? ae.selectionStart : null;
    renderShell();
    const v = $('#view');
    try {
      v.innerHTML = S.tab === 'queue' ? pageQueue() : S.tab === 'm360' ? pageM360() : S.tab === 'outreach' ? pageOutreach() : pageInsights();
    } catch (e) { console.error(e); v.innerHTML = `<div class="card err"><div class="card-b">${note('Something went wrong rendering this view. Use Reset demo to restore the starting state.', 'crit', 'octagon-alert')}<pre class="xs">${esc(e.message)}</pre></div></div>`; }
    renderCopilot();
    if (fid) { const el = document.getElementById(fid); if (el && el !== document.activeElement) { el.focus(); if (pos !== null && el.setSelectionRange) try { el.setSelectionRange(pos, pos); } catch (e) { /* noop */ } } }
  }

  function onClick(e) {
    const el = e.target.closest('[data-act]');
    if (el && el.classList.contains('modal-bg') && e.target.closest('[data-stop]')) return;
    if (!el || el.disabled) return;
    const act = el.dataset.act, fn = ACTIONS[act];
    if (!fn) return;
    if (el.tagName === 'INPUT' && el.type === 'checkbox') { /* allow native toggle */ } else e.preventDefault();
    const r = fn(el);
    if (r === false) return;
    save(); render();
  }

  function onInput(e) {
    const el = e.target;
    if (el.dataset.f) {
      S.f[el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value;
      save(); if (el.id !== 'f-q' || e.type === 'input') render(); return;
    }
    if (el.dataset.f2) { S[el.dataset.f2] = el.value; save(); return; }
    if (el.dataset.form) {
      const m = M(S.sel), f = formFor(m, routeFor(m)), k = el.dataset.form;
      f[k] = el.type === 'checkbox' ? el.checked : el.value;
      if (k === 'contactId') f.confirm = false;
      save(); if (el.dataset.rerender && e.type === 'change') render(); return;
    }
    if (el.dataset.ptask !== undefined) { const dr = S.drafts[S.sel]; dr.tasks[Number(el.dataset.ptask)][el.dataset.k] = el.value; save(); }
  }

  function onSubmit(e) {
    const f = e.target;
    if (f.dataset.actSubmit === 'cp') { e.preventDefault(); const i = $('#cp-input'); const q = i.value; i.value = ''; cpAsk(q); setTimeout(() => { const n = $('#cp-input'); if (n) n.focus(); }, 0); }
    if (f.dataset.actSubmit === 'modal') { e.preventDefault(); modalSubmit(); }
  }

  function onKey(e) {
    if (e.key === 'Escape') { if ($('#modal-root').innerHTML) { closeModal(); return; } if (S.copilot.open) { S.copilot.open = false; save(); render(); $('#copilot-edge').focus(); } return; }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('article[data-act]')) { e.preventDefault(); e.target.click(); }
  }

  /* ================================================================== boot */
  async function boot() {
    let raw;
    try {
      const res = await fetch('data/nexus-data.json', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      raw = await res.json();
    } catch (e) {
      $('#view').innerHTML = `<div class="card err"><div class="card-h"><div class="hi crit">${icon('octagon-alert')}</div><h3>Workbook data could not be loaded</h3></div><div class="card-b">${note(`data/nexus-data.json failed to load (${esc(e.message)}). Serve the folder over HTTP — e.g. <code>python3 -m http.server 8000</code> — rather than opening index.html from disk. No fallback data is used.`, 'crit', 'database')}</div></div>`;
      return;
    }
    CHECKS = validate(raw);
    const fatal = CHECKS.filter((c) => !c.ok && c.fatal);
    if (fatal.length) {
      $('#view').innerHTML = `<div class="card err"><div class="card-h"><div class="hi crit">${icon('octagon-alert')}</div><h3>Workbook validation failed</h3></div><div class="card-b">${CHECKS.map((c) => `<div class="check-i ${c.ok ? '' : 'fail'}">${icon(c.ok ? 'circle-check' : 'circle-x')}<span>${esc(c.text)}</span></div>`).join('')}<p class="small muted">Fix the workbook and re-run <code>python scripts/build_data.py</code>. No fabricated fallback data is shown.</p></div></div>`;
      return;
    }
    D = raw;
    P = D['Patient 360'].map((r) => { const s = L.score(r); return { id: r['Member ID'], name: r['Name'], score: s, band: L.band(s), raw: r }; }).sort((a, b) => b.score - a.score);
    S = load();
    if (!M(S.sel)) S.sel = P[0].id;
    document.addEventListener('click', onClick);
    document.addEventListener('input', onInput);
    document.addEventListener('change', onInput);
    document.addEventListener('submit', onSubmit);
    document.addEventListener('keydown', onKey);
    render();
  }
  boot();
})();
