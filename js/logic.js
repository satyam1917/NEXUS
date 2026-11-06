/* NEXUS Care Workbench — domain logic.
   Pure functions over workbook data. No DOM, no network, no external model.
   Nothing here adds clinical facts: every member-specific string comes from the workbook. */
(function (g) {
  'use strict';

  /* ------------------------------------------------------------------ priority engine */
  const FACTORS = [
    ['Clinical acuity', 40],
    ['Time sensitivity', 25],
    ['Care-gap severity', 20],
    ['Access barriers', 15],
  ];
  // Integer weights → exact hundredths, then half-up rounding to 1 dp.
  const scoreHundredths = (r) => FACTORS.reduce((s, [k, w]) => s + w * Number(r[k]), 0);
  const score = (r) => Math.floor((scoreHundredths(r) + 5) / 10) / 10;
  const band = (s) => (s >= 75 ? 'High' : s >= 50 ? 'Medium' : 'Routine');
  const contributions = (r) => FACTORS.map(([k, w]) => ({ factor: k, value: Number(r[k]), weight: w, points: (w * Number(r[k])) / 100 }));

  /* ------------------------------------------------------------------ helpers */
  const split = (s) => String(s || '').split(';').map((x) => x.trim()).filter(Boolean);
  const src = (D, mid, ds) => D['Source Records'].find((s) => s['Member ID'] === mid && s['Dataset'] === ds) || null;
  const contactsFor = (D, mid) => D['Contact Directory'].filter((c) => c['Member ID'] === mid);
  const memberContact = (D, mid) => contactsFor(D, mid).find((c) => c['Contact type'] === 'Member') || null;
  const altContacts = (D, mid) => contactsFor(D, mid).filter((c) => c['Contact type'] !== 'Member');
  const firstName = (n) => String(n || '').split(' ')[0];

  /* ------------------------------------------------------------------ case status */
  const CASE_SIM = ['Community active', 'Inpatient', 'Recently discharged'];
  function caseKind(status) {
    if (/inpatient/i.test(status)) return 'inpatient';
    if (/recently discharged/i.test(status)) return 'discharged';
    return 'community';
  }
  const isPrivacy = (D, m) => /privacy-sensitive/i.test(m['Case status']) ||
    /do not contact family/i.test((memberContact(D, m['Member ID']) || {})['Prohibited / restricted disclosure'] || '');

  /* ------------------------------------------------------------------ contact router */
  // Explicit status words, never colour-only.
  function contactStatus(D, m, c) {
    if (!c) return 'NOT AUTHORISED';
    const ver = String(c['Verification status']);
    if (c['Contact type'] === 'Member') {
      if (/disconnected/i.test(ver)) return 'DISCONNECTED';
      if (/unverified/i.test(ver)) return 'UNVERIFIED';
      return 'PERMITTED';
    }
    if (/emergency/i.test(c['Contact type'])) return 'NOT AUTHORISED';
    if (isPrivacy(D, m)) return 'NOT AUTHORISED';
    if (!/verified/i.test(ver) || /unverified/i.test(ver)) return 'REVIEW REQUIRED';
    if (/reconfirm/i.test(c['Permission / authority evidence']) || /reconfirm/i.test(m['Authorisation / permission status'])) return 'REVIEW REQUIRED';
    if (/limited scope/i.test(m['Authorisation / permission status']) || /\bonly\b/i.test(c['Permitted scope'])) return 'LIMITED SCOPE';
    return 'PERMITTED';
  }

  const rule = (D, re) => D['Contact Routing Rules'].find((r) => re.test(r['Case / contact condition'])) || null;
  const asTarget = (D, m, c) => c && ({
    id: c['Contact ID'], name: c['Contact name'], relationship: c['Relationship'], type: c['Contact type'],
    status: contactStatus(D, m, c), phone: c['Phone (fictional)'], channel: c['Preferred channel'],
    window: c['Availability window'], language: c['Language'], scope: c['Permitted scope'],
    restricted: c['Prohibited / restricted disclosure'], evidence: c['Permission / authority evidence'],
    verification: c['Verification status'], reviewed: c['Last verified / reviewed'], source: c['Source'], notes: c['Routing notes'],
  });

  function route(D, m, effStatus) {
    const mid = m['Member ID'];
    const me = asTarget(D, m, memberContact(D, mid));
    const alts = altContacts(D, mid).map((c) => asTarget(D, m, c));
    const alt = alts[0] || null;
    const privacy = isPrivacy(D, m);
    const kind = caseKind(effStatus);
    const out = { member: me, alternates: alts, privacy, kind, plan: m['Routing recommendation'], steps: [], warnings: [] };

    if (kind === 'inpatient') {
      out.key = 'inpatient';
      out.rule = rule(D, /inpatient/i);
      out.target = { id: 'ROLE-DC', name: 'Hospital care coordinator / discharge planner', relationship: 'Facility care team',
        type: 'Provider / discharge coordinator', status: 'REVIEW REQUIRED', channel: 'Facility line — confirm via admitting facility',
        window: 'Facility hours', language: '—', scope: 'Transition and discharge coordination', restricted: 'Minimum necessary; verify role and identity',
        evidence: 'Role defined in Contact Routing Rules — no named coordinator in connected demo data', role: true };
      out.why = 'Member is inpatient: coordinate the transition with the facility. Repeated direct calls to an admitted member are not the default workflow.';
      out.fallback = privacy ? null : alt;
      out.fallbackNote = privacy ? 'No third-party contact: privacy-sensitive case.' : alt ? `${alt.name} only where permitted, after confirming identity, permission and scope.` : 'No alternate contact on file.';
      out.steps = ['Confirm facility and identify the discharge planner', 'Verify role and identity before sharing information', 'Create discharge-coordination task', 'After discharge: member-first post-discharge workflow'];
      return out;
    }
    if (me && me.status === 'DISCONNECTED') {
      out.key = 'disconnected';
      out.rule = rule(D, /unreachable|disconnected/i);
      out.target = alt || null;
      out.why = `${firstName(me.name)}'s primary number is disconnected — do not retry it. Resolve identity and re-confirm ${alt ? firstName(alt.name) + "'s" : 'any alternate'} permission and scope first.`;
      out.blocked = me;
      out.fallback = null;
      out.fallbackNote = alt ? `${alt.name}: ${alt.scope.toLowerCase()} only, after identity and scope are re-confirmed.` : 'No alternate contact on file — escalate.';
      out.steps = ['Stop retries to the disconnected number', 'Resolve possible duplicate identity before any action', `Re-confirm ${alt ? alt.name : 'alternate'}'s identity and current scope`, 'Then coordinate outreach within scope only'];
      return out;
    }
    if (privacy || (me && me.status === 'UNVERIFIED')) {
      out.key = 'privacy';
      out.rule = rule(D, /privacy-sensitive/i);
      out.target = me;
      out.why = 'Privacy-sensitive case: member-only contact through a safe, member-approved channel. Third-party contacts are suppressed.';
      out.fallback = null;
      out.fallbackNote = 'None — no third-party permission recorded. Escalate to supervisor if no safe route can be confirmed.';
      out.suppressed = true;
      out.steps = ['Confirm a safe channel with the member (no sensitive details on voicemail/text)', `Use approved ${m['Language']}-language outreach`, 'Do not contact family or other third parties', 'Escalate to supervisor if no safe route'];
      return out;
    }
    out.key = kind === 'discharged' ? 'discharged' : 'community';
    out.rule = kind === 'discharged' ? rule(D, /recently discharged/i) : null;
    out.target = me;
    out.why = kind === 'discharged'
      ? `Recently discharged — member-first post-discharge workflow. ${alt ? alt.name + ' is a fallback within documented scope only.' : ''}`
      : `Member first. ${alt ? alt.name + ' only for permitted ' + alt.scope.replace(/ only$/i, '').toLowerCase() + '.' : ''}`;
    out.fallback = alt;
    out.fallbackNote = alt ? `${alt.name} (${alt.relationship.toLowerCase()}): ${alt.scope}. ${alt.restricted}.` : 'No alternate contact on file.';
    out.steps = ['Verify identity before discussing health information', 'Ask whether anyone else may join the conversation', alt ? `If unreachable: ${alt.name} for permitted logistics only` : 'If unreachable: approved channel and policy-defined retries'];
    return out;
  }

  /* ------------------------------------------------------------------ why now */
  function whyNow(m, simEvent) {
    const chips = [];
    const add = (icon, text, tone) => { if (!chips.some((c) => c.text === text)) chips.push({ icon, text, tone }); };
    if (simEvent) add('bell-ring', 'SIMULATED discharge event', 'sim');
    const trig = m['Trigger'];
    add(/discharge/i.test(trig) ? 'hospital' : /ED/.test(trig) ? 'activity' : /maternity/i.test(trig) ? 'baby' : 'clipboard-list', trig, 'info');
    const phone = m['Phone status'];
    if (/disconnected/i.test(phone)) add('phone-off', 'Member phone disconnected', 'crit');
    if (/unverified/i.test(phone)) add('lock', 'Safe contact channel unverified', 'warn');
    const dq = split(m['Data-quality issue']);
    dq.forEach((d) => { const id = d.match(/duplicate identity (\S+)/i); if (id) add('fingerprint', `Possible duplicate identity ${id[1]}`, 'crit'); });
    const med = m['Medication status'];
    if (/conflict/i.test(med)) add('git-compare', 'Medication records conflict — verify', 'crit');
    else if (/gap/i.test(med)) add('pill', 'Possible refill gap — confirm', 'warn');
    const appt = m['Appointment status'];
    if (/no .*found/i.test(appt)) add('calendar-x', appt, 'warn');
    else if (/delayed|unconfirmed/i.test(appt)) add('calendar-clock', appt, 'warn');
    dq.forEach((d) => {
      if (/hba1c missing/i.test(d)) add('flask-conical', d, 'warn');
      else if (/pharmacy feed delayed/i.test(d)) add('database', 'Pharmacy feed delayed', 'warn');
      else if (/sdoh screen/i.test(d)) add('hourglass', d + ' — reconfirm', 'warn');
      else if (/transport need unconfirmed/i.test(d)) add('car', 'Transport need unconfirmed', 'warn');
    });
    const sdoh = m['SDOH context'];
    if (/transport/i.test(sdoh) && !chips.some((c) => c.icon === 'car')) add('car', /lives alone/i.test(sdoh) ? 'Transport barrier · lives alone' : sdoh, 'warn');
    return { chips, sentence: chips.map((c) => c.text).join(' + ') };
  }

  /* ------------------------------------------------------------------ data trust */
  const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
  function trustItems(D, m) {
    const mid = m['Member ID'], items = [];
    const med = m['Medication context'];
    if (/conflict/i.test(m['Medication status']) && / vs /.test(med)) {
      const [a, b] = med.split(/ vs /);
      const r = src(D, mid, 'Medication / pharmacy');
      items.push({ type: 'Conflict', icon: 'git-compare', tone: 'crit', title: 'Medication dose records disagree', values: [a.trim(), b.trim()],
        detail: 'Both values shown. NEXUS does not choose one — verify with the member and care team.', source: r });
    }
    const id = m['Data-quality issue'].match(/duplicate identity (\S+)/i);
    if (id) items.push({ type: 'Identity', icon: 'fingerprint', tone: 'crit', title: `Possible duplicate identity ${id[1]}`,
      detail: 'Do not auto-merge. Resolve in the master member index before acting.', source: src(D, mid, 'Identity resolution') });
    split(m['Data-quality issue']).map(cap).forEach((d) => {
      if (/missing/i.test(d)) items.push({ type: 'Missing', icon: 'file-question', tone: 'warn', title: d, detail: 'Not available in connected data — request if relevant.', source: src(D, mid, 'Labs & vitals') });
      if (/delayed/i.test(d)) items.push({ type: 'Delayed', icon: 'hourglass', tone: 'warn', title: d, detail: 'A delayed feed may not reflect recent events.', source: src(D, mid, /pharmacy/i.test(d) ? 'Medication / pharmacy' : 'Appointments') });
      if (/unverified/i.test(d)) items.push({ type: 'Unverified', icon: 'lock', tone: 'warn', title: d, detail: 'Confirm a safe, member-approved channel before outreach.', source: src(D, mid, 'Contact history') });
      if (/unconfirmed/i.test(d)) items.push({ type: 'Unverified', icon: 'circle-dashed', tone: 'warn', title: d, detail: 'Ask the member; do not assume.', source: src(D, mid, 'SDOH') });
    });
    const appt = m['Appointment status'];
    if (/no .*found/i.test(appt)) items.push({ type: 'Not found', icon: 'calendar-x', tone: 'warn', title: appt,
      detail: "'Not found' means no record was returned by the connected feed — it does not prove no appointment exists.", source: src(D, mid, 'Appointments') });
    if (/unconfirmed/i.test(appt)) items.push({ type: 'Unverified', icon: 'calendar-clock', tone: 'warn', title: appt, detail: 'Confirm with the member or provider — do not assume either way.', source: src(D, mid, 'Appointments') });
    const ms = m['Medication status'];
    if (!/conflict/i.test(ms) && /gap|unconfirmed|confirm|unknown|verification/i.test(ms)) items.push({ type: 'Unverified', icon: 'pill', tone: 'warn', title: `Medication: ${ms}`, detail: `${m['Medication context']}. Order, fill and member report are different things — confirm, don't infer.`, source: src(D, mid, 'Medication / pharmacy') });
    if (/delayed/i.test(appt) && !items.some((i) => /appointment/i.test(i.title))) items.push({ type: 'Delayed', icon: 'calendar-clock', tone: 'warn', title: appt, detail: 'Confirm directly with the care team.', source: src(D, mid, 'Appointments') });
    if (/disconnected/i.test(m['Phone status'])) items.push({ type: 'Unreachable', icon: 'phone-off', tone: 'crit', title: 'Primary phone disconnected', detail: 'Stop retries; resolve contact data.', source: src(D, mid, 'Contact history') });
    const s = src(D, mid, 'SDOH');
    if (s) items.push({ type: 'Stale', icon: 'hourglass', tone: 'muted', title: `Self-reported SDOH: ${s['Sample fact']}`,
      detail: /months ago/i.test(m['SDOH context']) ? `Patient 360 says "${m['SDOH context']}"; Source Records freshness is ${s['Freshness (illustrative)']}. Reconfirm before referral.` : `Freshness ${s['Freshness (illustrative)']}. Reconfirm before referral.`, source: s });
    const c = src(D, mid, 'Claims');
    if (c) items.push({ type: 'Historical', icon: 'history', tone: 'muted', title: 'Claims are historical context only', detail: `${c['Quality flag']} · ${c['Freshness (illustrative)']}. Not used as a real-time trigger.`, source: c });
    return items;
  }

  /* Medication: order ≠ dispense ≠ patient-reported ≠ adherence. */
  function medLanes(D, m, reported) {
    const mid = m['Member ID'], r = src(D, mid, 'Medication / pharmacy');
    const lanes = [
      { key: 'order', title: 'Order / medication list', icon: 'file-text', items: [] },
      { key: 'fill', title: 'Pharmacy fill', icon: 'pill', items: [] },
      { key: 'reported', title: 'Member-reported', icon: 'message-square', items: [] },
      { key: 'adherence', title: 'Adherence', icon: 'scale', items: [] },
    ];
    const by = Object.fromEntries(lanes.map((l) => [l.key, l]));
    const segs = split(m['Medication context']).flatMap((s) => s.split(/ vs /));
    segs.forEach((s) => {
      if (/fill/i.test(s)) by.fill.items.push(s);
      else if (/\buse\b|taking/i.test(s)) by.reported.items.push(s);
      else by.order.items.push(s);
    });
    if (/gap/i.test(m['Medication status']) && !by.fill.items.some((x) => /gap/i.test(x))) by.fill.items.unshift(m['Medication status']);
    (reported || []).forEach((x) => by.reported.items.push(`“${x}” (session note, unverified)`));
    lanes.forEach((l) => { if (!l.items.length && l.key !== 'adherence') l.items.push(l.key === 'reported' ? 'Not yet captured — ask the member' : 'Not available in connected data'); });
    by.adherence.items.push('Not assessed — cannot be inferred from orders or fills');
    return { lanes, status: m['Medication status'], source: r };
  }

  /* Event timeline from Source Records + session events. */
  function ageDays(f) {
    f = String(f || '');
    if (/near-real-time|^current$/i.test(f.trim())) return 0;
    const x = f.match(/(\d+)(?:–\d+)?\s*(day|month)/i);
    return x ? Number(x[1]) * (/month/i.test(x[2]) ? 30 : 1) : 999;
  }
  function timeline(D, mid, sessionEvents) {
    const rows = sessionEvents.filter((e) => e.mid === mid).map((e) => ({ ...e, age: -1 }));
    D['Source Records'].filter((s) => s['Member ID'] === mid && !/Member & eligibility|Care plan|Identity resolution/.test(s['Dataset']))
      .forEach((s) => rows.push({ label: s['Dataset'] === 'Contact history' ? `Member contact: ${s['Sample fact']}` : s['Sample fact'], dataset: s['Dataset'], source: s['Source'], eventTime: null, receivedTime: null,
        freshness: s['Freshness (illustrative)'], quality: s['Quality flag'], action: s['What nurse should do'], age: ageDays(s['Freshness (illustrative)']) }));
    return rows.sort((a, b) => a.age - b.age);
  }

  /* ------------------------------------------------------------------ call brief */
  function callBrief(D, m, rt) {
    const ctx = [m['Medication context'], m['Medication status'], m['Appointment status'], m['SDOH context'], m['Data-quality issue']].join(' ').toLowerCase();
    const q = [];
    q.push('Can you confirm your full name and date of birth so I know I am speaking with the right person?');
    if (rt.key === 'privacy' || rt.key === 'disconnected') q.push('What is the safest number and time to reach you? Is it OK to leave a message?');
    if (/no .*follow-up|unconfirmed|delayed/.test(m['Appointment status'].toLowerCase())) q.push('Were you able to schedule the follow-up appointment? With whom, and when?');
    else if (/visit in/i.test(m['Appointment status'])) q.push(`Our records show a ${m['Appointment status'].replace(/ in .*/, '')} coming up — is that still planned?`);
    if (/discharge list/.test(ctx)) q.push('Have you been able to obtain the medication listed in your discharge instructions?');
    if (/refill|fill/.test(ctx) && !/discharge/.test(ctx)) q.push('Have you been able to pick up your refills? Is anything making that hard?');
    if (/medication use unknown/.test(ctx)) q.push('Which medicines, if any, are you taking at the moment?');
    if (/instructions require/.test(ctx)) q.push('What instructions has your maternity care team given you? (Record only — confirm with the care team.)');
    if (/transport/.test(ctx)) q.push('Would transport assistance make it easier to attend your appointments?');
    if (/food/.test(ctx)) q.push('Is getting enough food still a concern? Would you like information about food support?');
    if (/housing/.test(ctx)) q.push('Would you like to talk with a social worker about housing support?');
    if (/hba1c/.test(ctx)) q.push('Have you had an HbA1c blood test recently? Where was it done?');
    q.push('Would you like us to coordinate with your care team?');

    const verify = [];
    verify.push('Identity (name + date of birth) before any health information');
    if (/conflict/i.test(m['Medication status'])) verify.push(`Medication discrepancy: ${m['Medication context']} — verify with care team; do not choose a dose`);
    else if (/confirm|unconfirmed|verification/i.test(m['Medication status'])) verify.push(`Medication: ${m['Medication context']} (${m['Medication status']})`);
    if (/duplicate/i.test(m['Data-quality issue'])) verify.push(m['Data-quality issue'] + ' — resolve before action');
    if (rt.fallback || rt.target && rt.target.type !== 'Member') verify.push('Third-party permission is still active and within documented scope');
    const s = src(D, m['Member ID'], 'SDOH');
    if (s) verify.push(`SDOH is self-reported (${s['Freshness (illustrative)']}) — reconfirm before referral`);

    const warn = [];
    if (rt.key === 'privacy') warn.push({ tone: 'crit', icon: 'shield-alert', text: 'Privacy-sensitive: member-only. Never leave sensitive details on voicemail or text. No family contact.' });
    if (rt.key === 'disconnected') warn.push({ tone: 'crit', icon: 'phone-off', text: `Do not call ${m['Name']}'s disconnected number again. Identity exception open.` });
    if (rt.key === 'inpatient') warn.push({ tone: 'warn', icon: 'hospital', text: 'Inpatient (simulated): coordinate with the facility, not repeated member calls.' });
    if (m['Language'] !== 'English') warn.push({ tone: 'info', icon: 'languages', text: `Use approved ${m['Language']}-language outreach.` });
    const t = rt.target;
    if (t && t.type !== 'Member' && !t.role) warn.push({ tone: 'warn', icon: 'users', text: `If speaking with ${t.name}: ${t.scope.toLowerCase()} only. ${t.restricted}.` });

    return { reason: `${m['Trigger']} · ${m['Programme']}`, action: m['Next best action'], questions: q, verify, warn,
      gaps: whyNow(m).chips.slice(1) };
  }

  /* ------------------------------------------------------------------ note drafter */
  const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); if (d.getDay() === 6) d.setDate(d.getDate() + 2); if (d.getDay() === 0) d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); };

  function draftNote(D, m, rt, f, today) {
    const mid = m['Member ID'];
    const person = [rt.member, ...rt.alternates, rt.target].find((c) => c && c.id === f.contactId) || rt.member;
    const thirdParty = person && person.type !== 'Member';
    const connected = /connected/i.test(f.outcome) && !/not/i.test(f.outcome);
    const who = thirdParty ? `Reported by ${person.name} (${person.relationship.toLowerCase()}, ${person.status.toLowerCase()})` : 'Member reported';
    const text = [f.reported, f.appointment, f.medication, f.barrier, f.preference, f.followup, f.free, f.dictation].join(' ').toLowerCase();

    const lines = [];
    lines.push(`Outreach note — ${m['Name']} (${mid})`);
    lines.push(`Outcome: ${f.outcome} · Contacted: ${person ? person.name + ' (' + person.relationship + ')' : '—'} · Channel: ${f.channel} · ${f.when}`);
    lines.push(`Reason: ${m['Trigger']} (${m['Programme']})`);
    lines.push('');
    if (connected) {
      const rep = [['Update', f.reported], ['Appointment / referral', f.appointment], ['Medication access', f.medication], ['Social / access barrier', f.barrier], ['Preference', f.preference], ['Follow-up commitment', f.followup]].filter(([, v]) => v && v.trim());
      if (rep.length || (f.dictation || '').trim() || (f.free || '').trim()) {
        lines.push(`[${who.toUpperCase()}]`);
        rep.forEach(([k, v]) => lines.push(`• ${k}: ${v.trim()}`));
        if ((f.free || '').trim()) lines.push(`• Note: ${f.free.trim()}`);
        if ((f.dictation || '').trim()) lines.push(`• Nurse dictation (typed): ${f.dictation.trim()}`);
      } else lines.push('[MEMBER REPORTED] — nothing entered');
    } else {
      lines.push(`No conversation took place (${f.outcome}). Nothing below is member-reported.`);
      if (/wrong number/i.test(f.outcome)) lines.push('Do not document health details. Contact record flagged for verification.');
    }
    lines.push('');
    lines.push('[SOURCE RECORD]');
    const elig = src(D, mid, 'Member & eligibility');
    if (elig) lines.push(`• Eligibility/programme: ${elig['Quality flag']} (${elig['Source']})`);
    const adt = src(D, mid, 'ADT / event');
    if (adt) lines.push(`• Event: ${adt['Sample fact']} (${adt['Source']}, ${adt['Freshness (illustrative)']})`);
    lines.push(`• Conditions on file: ${m['Conditions']} (Provider EHR)`);
    lines.push('');
    lines.push('[NEEDS VERIFICATION]');
    if (/conflict|confirm|unconfirmed|verification|needed/i.test(m['Medication status'])) lines.push(`• Medication: ${m['Medication context']} — ${m['Medication status']}`);
    if (!/visit in/i.test(m['Appointment status'])) lines.push(`• Appointment: ${m['Appointment status']}`);
    lines.push(`• SDOH (self-reported): ${m['SDOH context']}`);
    split(m['Data-quality issue']).forEach((d) => lines.push(`• Data quality: ${d}`));
    if (thirdParty) lines.push(`• Third-party scope: ${person.scope}. ${person.restricted}.`);

    const domains = [
      ['Medication access', /medic|pill|refill|dose|mg|inhaler|metformin|pharmac/, f.medication, `${m['Medication context']} (${m['Medication status']})`],
      ['Follow-up appointment', /appoint|visit|pcp|clinic|schedul|booked/, f.appointment, m['Appointment status']],
      ['Social / access needs', /transport|ride|food|housing|meal|bus|social/, f.barrier, m['SDOH context']],
      ['Contact & preference', null, f.preference, `${m['Primary contact route']} · ${m['Primary contact availability']}`],
    ];
    if (/hba1c/i.test(m['Data-quality issue'])) domains.push(['Labs (HbA1c)', /hba1c|a1c|lab/, '', 'Latest HbA1c missing']);
    const assessment = domains.map(([d, re, field, record]) => {
      const said = connected && ((field && field.trim()) || (re && re.test(text)));
      return { domain: d, label: said ? who : 'Needs verification', detail: said ? (field && field.trim() ? field.trim() : 'Discussed — see note') + ` · record: ${record}` : `Not discussed. Record: ${record}` };
    });

    const care = split(m['Next best action']).map((a) => ({ text: a.charAt(0).toUpperCase() + a.slice(1), note: 'From workbook next-best-action — keep, edit or remove' }));
    if (connected && /transport|ride/.test(text)) care.push({ text: 'Consider transport-assistance referral', note: 'Eligibility to be confirmed by nurse' });
    if (connected && /food|meal/.test(text)) care.push({ text: 'Offer food-support resources', note: 'Reconfirm need with member first' });
    if (connected && /housing|social work/.test(text)) care.push({ text: 'Offer social-work referral', note: 'Member consent required' });

    const owner = m['Case manager'];
    const due = addDays(today, 1);
    const tasks = [];
    if (connected && f.followup && f.followup.trim()) tasks.push({ title: `Follow up: ${f.followup.trim()}`, owner, due, why: 'Follow-up commitment entered by nurse' });
    if (!connected) tasks.push(/wrong number/i.test(f.outcome)
      ? { title: 'Verify and correct contact record', owner, due: today, why: 'Wrong number recorded' }
      : { title: 'Re-attempt outreach via approved channel per programme retry policy', owner, due, why: `Outcome: ${f.outcome}` });
    if (/conflict/i.test(m['Medication status'])) tasks.push({ title: 'Verify medication record discrepancy with discharging care team', owner, due: today, why: m['Medication context'] });
    if (/no .*found|unconfirmed|delayed/i.test(m['Appointment status']) && !(connected && f.appointment && /booked|scheduled|confirmed/i.test(f.appointment)))
      tasks.push({ title: 'Confirm follow-up appointment with provider scheduling', owner, due, why: m['Appointment status'] });
    if (connected && /transport|ride/.test(text)) tasks.push({ title: 'Arrange transport assistance if member is eligible', owner, due, why: 'Transport mentioned in conversation' });

    return { note: lines.join('\n'), assessment, care, tasks: tasks.slice(0, 4), thirdParty, person, connected };
  }

  /* ------------------------------------------------------------------ scribe (synthetic) */
  function syntheticTranscript(m, rt) {
    const t = rt.target && !rt.target.role ? rt.target : rt.member;
    const nm = firstName(t.name);
    const L = [['RN', `Hi, this is Maria Chen, a nurse case manager with your health plan. Am I speaking with ${t.name}?`], [nm, 'Yes, that’s me.'],
      ['RN', 'Before we continue, can you confirm your date of birth?'], [nm, '[date of birth confirmed — synthetic]']];
    if (/appointment|follow-up/i.test(m['Appointment status'] + m['Next best action'])) { L.push(['RN', 'Were you able to schedule a follow-up appointment?']); L.push([nm, 'Not yet, I was going to call this week.']); }
    if (/transport/i.test(m['SDOH context'])) { L.push(['RN', 'Would help with transport make it easier to get there?']); L.push([nm, 'Yes, getting a ride is hard sometimes.']); }
    L.push(['RN', 'I will note that and follow up. Is this the best number to reach you?']); L.push([nm, 'Yes, weekday mornings are best.']);
    const ents = [
      { kind: 'Appointment status', value: 'Not yet scheduled', label: 'Member reported' },
      { kind: 'Barrier', value: /transport/i.test(m['SDOH context']) ? 'Transport difficulty' : '—', label: 'Member reported' },
      { kind: 'Commitment', value: 'Nurse to follow up on appointment', label: 'Needs verification' },
      { kind: 'Contact preference', value: 'Weekday mornings', label: 'Member reported' },
    ].filter((e) => e.value !== '—');
    return { lines: L, entities: ents, speaker: t };
  }

  /* ------------------------------------------------------------------ copilot */
  const REFUSE = /\b(diagnos|prescrib|should (i|we) (change|increase|decrease|stop)|which dose|correct dose|right dose|adjust|titrat|triage|emergency|is it safe to)/i;

  function copilot(D, q, ctx) {
    const P = D['Patient 360'];
    const text = String(q || '').trim();
    let m = P.find((p) => new RegExp(`\\b${p['Member ID']}\\b`, 'i').test(text)) ||
      P.find((p) => new RegExp(`\\b(${firstName(p['Name'])}|${p['Name'].split(' ')[1]})\\b`, 'i').test(text)) || ctx.member;
    const ev = (label, detail) => ({ label, detail });
    const res = { blocks: [], evidence: [], actions: [] };
    const needMember = () => { if (!m) { res.blocks.push({ p: 'Select a member first (or name one, e.g. NX-001) — I only answer from that member’s demo record.' }); return true; } return false; };

    if (REFUSE.test(text)) {
      res.title = 'Outside what I can do';
      res.blocks.push({ warn: 'I can’t diagnose, prescribe, choose between medication doses, change treatment or triage emergencies. These stay with the clinician and the plan’s approved protocol.' });
      res.blocks.push({ p: 'I can show the conflicting records side by side and draft verification questions for the care team.' });
      res.evidence.push(ev('Guardrail', 'AI Copilot sheet · Conflict explanation: “Never choose dose or recommend medication change”'));
      return res;
    }
    if (/not found/i.test(text)) {
      res.title = 'What “Not found” means';
      res.blocks.push({ p: '“Not found” means the connected (here: simulated) feed returned no record. It does not prove the appointment or event did not happen — the provider may not be connected, or the feed may be delayed.' });
      res.blocks.push({ list: ['Confirm directly with the member or provider scheduling', 'Record what you confirm as member-reported or source-verified', 'Do not treat absence as a confirmed care gap'] });
      const dd = D['Data Dictionary'].find((d) => /Appointments/.test(d['Dataset']));
      if (dd) res.evidence.push(ev('Data Dictionary · Appointments & referrals', `${dd['Handling / product behaviour']} · expected freshness ${dd['Expected freshness']}`));
      return res;
    }
    if (/inpatient/i.test(text) && !/why/i.test(text.replace(/inpatient/i, ''))) {
      const r = rule(D, /inpatient/i);
      res.title = 'When a member is inpatient';
      res.blocks.push({ kv: [['Preferred target', r['Preferred outreach target']], ['Fallback', r['Fallback']], ['System behaviour', r['System behaviour']], ['Disclosure', r['Disclosure control']], ['Next step', r['Escalation / next step']]] });
      res.blocks.push({ p: 'Try it: Member 360 → “Simulate case status” → Inpatient.' });
      res.evidence.push(ev('Contact Routing Rules', r['Case / contact condition']));
      return res;
    }
    if (/(why|priority|score|rank|first)/i.test(text) && !/call|number|contact/i.test(text)) {
      if (needMember()) return res;
      const s = score(m), c = contributions(m), w = whyNow(m, ctx.simFor(m['Member ID']));
      res.title = `Why ${m['Name']} is ${band(s)} priority (${s.toFixed(1)})`;
      res.blocks.push({ p: `Why now: ${w.sentence}.` });
      res.blocks.push({ bars: c });
      res.blocks.push({ p: `Score = 0.40×${m['Clinical acuity']} + 0.25×${m['Time sensitivity']} + 0.20×${m['Care-gap severity']} + 0.15×${m['Access barriers']} = ${s.toFixed(1)} → ${band(s)} (≥75 High, 50–74 Medium).` });
      res.blocks.push({ note: 'Illustrative operational work-queue score — not a clinical risk prediction. You can defer or reassign with a reason.' });
      res.evidence.push(ev(`Patient 360 · ${m['Member ID']}`, 'Factor values, trigger, data-quality issue'));
      res.evidence.push(ev('Priority Model', '0.40A + 0.25T + 0.20G + 0.15B · bands are governance hypotheses'));
      const a = src(D, m['Member ID'], 'ADT / event'); if (a) res.evidence.push(ev(`Source Records · ${a['Source']}`, `${a['Sample fact']} · ${a['Freshness (illustrative)']}`));
      return res;
    }
    if (/(not call|call .* again|disconnected|number again|retry)/i.test(text)) {
      if (needMember()) return res;
      const rt = route(D, m, ctx.statusFor(m));
      if (rt.key !== 'disconnected') { res.title = 'Contact status'; res.blocks.push({ p: `${m['Name']}'s number is ${rt.member.verification}. No retry restriction applies; follow ${rt.key === 'privacy' ? 'the privacy-sensitive safe-channel rule' : 'the member-first rule'}.` }); res.evidence.push(ev(`Contact Directory · ${rt.member.id}`, `Verification: ${rt.member.verification} · reviewed ${rt.member.reviewed}`)); return res; }
      res.title = `Why not call ${firstName(m['Name'])}'s number again`;
      res.blocks.push({ p: `The primary number ${rt.member.phone} is recorded as Disconnected. Repeated attempts to an invalid number waste effort and delay a safe route.` });
      res.blocks.push({ list: rt.steps });
      res.blocks.push({ note: `${rt.target.name} (${rt.target.relationship.toLowerCase()}) is ${rt.target.status}: ${rt.target.evidence}. Scope: ${rt.target.scope}. ${rt.target.restricted}.` });
      res.evidence.push(ev(`Contact Directory · ${rt.member.id}`, `${rt.member.restricted} · reviewed ${rt.member.reviewed}`));
      res.evidence.push(ev(`Contact Directory · ${rt.target.id}`, `${rt.target.notes} · reviewed ${rt.target.reviewed}`));
      res.evidence.push(ev('Contact Routing Rules', rt.rule['Case / contact condition']));
      return res;
    }
    if (/\b(who can|contact|reach|caregiver|family|spouse|son|sister)\b/i.test(text) && !/draft/i.test(text)) {
      if (needMember()) return res;
      const rt = route(D, m, ctx.statusFor(m));
      res.title = `Who can I contact for ${m['Name']}?`;
      res.blocks.push({ route: rt });
      res.blocks.push({ p: rt.why });
      if (rt.suppressed) res.blocks.push({ warn: 'No family or third-party contact is suggested for this member.' });
      res.evidence.push(ev(`Contact Directory · ${m['Member ID']}`, contactsFor(D, m['Member ID']).map((c) => `${c['Contact name']}: ${c['Verification status']}, reviewed ${c['Last verified / reviewed']}`).join(' · ')));
      if (rt.rule) res.evidence.push(ev('Contact Routing Rules', rt.rule['Case / contact condition']));
      res.evidence.push(ev(`Patient 360 · ${m['Member ID']}`, `Routing recommendation · last permission review ${m['Last permission review']}`));
      return res;
    }
    if (/(draft).*task|task.*(transport|confirm)/i.test(text)) {
      if (needMember()) return res;
      const topic = /transport/i.test(text) ? 'Confirm transport support' : /appointment|follow/i.test(text) ? 'Confirm follow-up appointment' : /medic/i.test(text) ? 'Verify medication information with care team' : 'Follow up on open care-plan item';
      const t = { title: `${topic} for ${m['Name']}`, owner: m['Case manager'], due: addDays(ctx.today, 1), why: `Copilot draft from request: “${text}”` };
      res.title = 'Draft task (not dispatched)';
      res.blocks.push({ kv: [['Task', t.title], ['Owner', `${t.owner} (RN case manager)`], ['Due (suggested)', t.due], ['Status', 'Draft — needs your approval']] });
      res.blocks.push({ note: 'Nothing has been created or sent. Add it as a draft, then approve it in Outreach & Notes.' });
      res.actions.push({ label: 'Add as draft task', act: 'draftTask', payload: { ...t, mid: m['Member ID'] } });
      res.evidence.push(ev(`Patient 360 · ${m['Member ID']}`, `SDOH: ${m['SDOH context']} · Next best action: ${m['Next best action']}`));
      return res;
    }
    if (/medic|conflict|dose|refill|inhaler|metformin/i.test(text)) {
      const list = m ? [m] : P;
      res.title = m ? `Medication records — ${m['Name']}` : 'Medication records needing verification';
      list.forEach((p) => {
        const ml = medLanes(D, p, ctx.reportedMeds(p['Member ID']));
        res.blocks.push({ kv: ml.lanes.map((l) => [l.title, l.items.join(' · ')]).concat([['Status', ml.status]]) });
        res.evidence.push(ev(`Source Records · ${p['Member ID']} · ${ml.source['Source']}`, `${ml.source['Quality flag']} · ${ml.source['Freshness (illustrative)']}`));
      });
      res.blocks.push({ note: 'Order, pharmacy fill, member report and adherence are kept separate. I will not pick between conflicting values — verify with the member and care team.' });
      return res;
    }
    if (/(brief|prepare|prep|call plan|questions)/i.test(text)) {
      if (needMember()) return res;
      const rt = route(D, m, ctx.statusFor(m)), b = callBrief(D, m, rt);
      res.title = `Call brief — ${m['Name']}`;
      res.blocks.push({ kv: [['Reason', b.reason], ['Target', rt.target ? `${rt.target.name} · ${rt.target.status}` : '—'], ['Language / window', `${m['Language']} · ${rt.target ? rt.target.window : '—'}`]] });
      res.blocks.push({ list: b.questions.slice(0, 5) });
      b.warn.forEach((w) => res.blocks.push({ warn: w.text }));
      res.actions.push({ label: 'Open full brief in Outreach & Notes', act: 'goto', payload: { tab: 'outreach', mid: m['Member ID'] } });
      res.evidence.push(ev(`Patient 360 · ${m['Member ID']}`, 'Trigger, gaps, next best action'));
      res.evidence.push(ev(`Contact Directory · ${m['Member ID']}`, 'Target, scope, availability'));
      return res;
    }
    if (/(summar|discharge|gaps|overview|story|what.*happen)/i.test(text)) {
      if (needMember()) return res;
      const ti = trustItems(D, m);
      res.title = `Summary — ${m['Name']} (${m['Member ID']})`;
      res.blocks.push({ labelled: [
        ['Source record', `${m['Age']} · ${m['Programme']} · ${m['Conditions']}`],
        ['Source record', `Trigger: ${m['Trigger']} (${(src(D, m['Member ID'], 'ADT / event') || {})['Freshness (illustrative)'] || '—'})`],
        ['Needs verification', `Medication: ${m['Medication context']} — ${m['Medication status']}`],
        ['Needs verification', `Appointment: ${m['Appointment status']}`],
        ['Self-reported', `SDOH: ${m['SDOH context']}`],
      ] });
      res.blocks.push({ p: `Open data issues: ${ti.filter((i) => i.tone !== 'muted').map((i) => i.title).join('; ') || 'none'}.` });
      res.blocks.push({ p: `Next best action (draft): ${m['Next best action']}.` });
      res.evidence.push(ev(`Patient 360 · ${m['Member ID']}`, 'Profile, trigger, medication, appointment, SDOH'));
      res.evidence.push(ev(`Source Records · ${m['Member ID']}`, 'Freshness and quality flags'));
      return res;
    }
    if (/(fresh|stale|delay|data quality|trust)/i.test(text)) {
      if (needMember()) return res;
      res.title = `Data freshness — ${m['Name']}`;
      res.blocks.push({ kv: D['Source Records'].filter((s) => s['Member ID'] === m['Member ID']).map((s) => [s['Dataset'], `${s['Freshness (illustrative)']} · ${s['Quality flag']}`]) });
      res.blocks.push({ note: 'Freshness labels are illustrative in this demo; no real timestamps exist.' });
      res.evidence.push(ev(`Source Records · ${m['Member ID']}`, '11 datasets'));
      return res;
    }
    res.title = 'I cannot verify this from the connected demo data';
    res.blocks.push({ p: 'I answer only from the selected member’s workbook record, contact permissions, routing rules and approved workflow help. Try one of the suggested questions.' });
    return res;
  }

  g.NXL = { FACTORS, score, band, contributions, CASE_SIM, caseKind, isPrivacy, contactsFor, memberContact, altContacts, contactStatus,
    route, whyNow, trustItems, medLanes, timeline, callBrief, draftNote, syntheticTranscript, copilot, src, split, addDays, firstName, scoreHundredths };
})(window);
