const app = document.querySelector('#app');
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clock = slot => `${String(Math.floor(slot / 2)).padStart(2, '0')}:${slot % 2 ? '30' : '00'}`;
const dateObject = value => new Date(value + 'T12:00:00Z');
const day = value => dateObject(value).toLocaleDateString('en-GB', { weekday:'short', month:'short', day:'numeric', timeZone:'UTC' });
const meetingId = location.pathname.match(/^\/m\/([\w-]{32,48})$/)?.[1];
let session = { user:null, csrf:'', emailEnabled:false };
let meeting, identity, organizerKey, selected = new Set(), mode = 'results', dirty = false, showSchedule = false;

function notice(message) {
  document.querySelector('#notice').textContent = message;
  clearTimeout(notice.timer);
  notice.timer = setTimeout(() => document.querySelector('#notice').textContent = '', 6500);
}
async function api(path, data) {
  const response = await fetch('/api.php?path=' + encodeURIComponent(path), data === undefined ? {} : {
    method:'POST', headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrf}, body:JSON.stringify(data)
  });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error || 'Unable to complete this request. Please try again.');
    error.status = response.status;
    throw error;
  }
  if (result.csrf) session.csrf = result.csrf;
  return result;
}
function readLocal(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
function writeLocal(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch { notice('This browser cannot remember your response. Keep your private edit link.'); }
}
function navigation() {
  document.querySelector('#navigation').innerHTML = session.user
    ? '<a href="/dashboard">My meetings</a><a href="/new">New meeting</a><button class="text-button small" id="logout">Log out</button>'
    : '<a href="/#how-it-works">How it works</a><a href="/login">Log in</a><a class="button small" href="/register">Get started</a>';
  document.querySelector('#logout')?.addEventListener('click', async () => {
    try { await api('/auth/logout', {}); location.href = '/'; } catch (error) { notice(error.message); }
  });
}
function previewCalendar() {
  let cells = '<span></span>' + ['MON','TUE','WED','THU'].map(d => `<span class="preview-day">${d}</span>`).join('');
  const shades = [[1,2,1,2],[2,2,3,3],[1,3,4,3],[2,2,4,2],[1,1,3,2]];
  shades.forEach((row, i) => {
    cells += `<span class="preview-time">${9+i}:00</span>` + row.map(shade => `<span class="preview-cell shade${shade}"></span>`).join('');
  });
  return `<div class="hero-preview" aria-label="Example availability preview"><div class="preview-window"><div class="preview-top"><strong>Our next catch-up</strong><span class="badge">Example</span></div><div class="preview-grid">${cells}</div><div class="preview-bottom"><div class="avatars"><span class="avatar">A</span><span class="avatar">J</span><span class="avatar">M</span><span class="avatar">S</span></div><span class="muted">4 people. One shared time.</span></div></div><div class="preview-toast"><b class="check-icon">✓</b><div><strong>A time that works for everyone</strong><span>Wednesday, 11:00 – 12:00</span></div></div></div>`;
}
function landingPage() {
  app.innerHTML = `<section class="hero"><div class="hero-copy"><span class="badge">A simpler way to get together</span><h1>Good company.<br>Busy calendars.<br><em>One shared time.</em></h1><p>Find when everyone is free, without the endless back-and-forth. Make a plan and bring your people together.</p><div class="hero-actions"><a class="button" href="/new">Create a meeting <span aria-hidden="true">→</span></a><a href="#how-it-works">See how it works ↗</a></div><p class="hero-note"><span>✓ Free to use</span><span>✓ Guests can join without an account</span></p></div>${previewCalendar()}</section><div class="use-cases"><span>Made for your everyday plans</span><strong>Study groups</strong><strong>Team catch-ups</strong><strong>Friends & family</strong><strong>Community events</strong></div><section class="how-section" id="how-it-works"><div class="section-title"><span class="eyebrow">From “when?” to “see you there”</span><h2>Three steps. Everyone together.</h2><p>Spend less time organizing and more time on what you actually planned.</p></div><div class="steps"><article><span class="step-number">01</span><h3>Make a little room</h3><p>Name your meeting, pick a few dates, and choose how long you need.</p></article><article><span class="step-number">02</span><h3>Let everyone weigh in</h3><p>Share a link. Your group adds their name, email, and the times they can make it.</p></article><article><span class="step-number">03</span><h3>Find your shared time</h3><p>Compare the blue availability grid, confirm a time, and notify your group by email.</p></article></div></section><section class="landing-bottom"><div><h2>Your next plan starts here.</h2><p>Bring the people. We’ll help you find the time.</p></div><a class="button" href="/new">Plan something together →</a></section>`;
}
function authPage(type) {
  const titles = {login:'Welcome back.',register:'Make time together.',forgot:'Forgot your password?',reset:'Choose a new password.',verify:'Verify your email.'};
  const subtitles = {login:'Log in to manage your meetings and availability.',register:'Create your account and start planning your first meeting.',forgot:'We’ll send a secure link to reset your password.',reset:'Use at least 12 characters for your new password.',verify:'Confirm your email address to complete your account setup.'};
  const fragment = new URLSearchParams(location.hash.slice(1));
  const token = fragment.get(type);
  if (token) history.replaceState(null, '', location.pathname);
  const emailField = ['login','register','forgot'].includes(type) ? '<div class="field"><label for="email">Email address</label><input id="email" name="email" type="email" autocomplete="email" maxlength="254" required></div>' : '';
  const passwordField = ['login','register','reset'].includes(type) ? `<div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="${type === 'login' ? 'current-password' : 'new-password'}" ${type === 'login' ? '' : 'minlength="12"'} maxlength="72" required></div>` : '';
  const labels = {login:'Log in',register:'Create account',forgot:'Send reset link',reset:'Update password',verify:'Verify email'};
  app.innerHTML = `<section class="auth-layout"><div class="card"><span class="eyebrow">Scheduler</span><h1>${titles[type]}</h1><p>${subtitles[type]}</p><form id="auth-form">${type === 'register' ? '<div class="field"><label for="name">Your name</label><input id="name" name="name" autocomplete="name" maxlength="60" required></div>' : ''}${emailField}${passwordField}<p id="form-error" class="form-error" role="alert"></p><button class="primary" type="submit">${labels[type]}</button></form>${type === 'login' ? '<p class="auth-links"><a href="/forgot">Forgot password?</a></p><p class="auth-links">New here? <a href="/register">Create an account</a></p>' : '<p class="auth-links"><a href="/login">Back to log in</a></p>'}</div></section>`;
  document.querySelector('#auth-form').onsubmit = async event => {
    event.preventDefault();
    const button = event.target.querySelector('button');
    button.disabled = true;
    try {
      const values = Object.fromEntries(new FormData(event.target));
      if (token) values.token = token;
      const result = await api('/auth/' + type, values);
      if (['login','register'].includes(type)) location.href = '/dashboard';
      else {
        document.querySelector('#auth-form').innerHTML = `<div class="notice-box" role="status">${escape(result.message)}</div>`;
      }
    } catch (error) {
      document.querySelector('#form-error').textContent = error.message;
      button.disabled = false;
    }
  };
}
async function dashboardPage() {
  if (!session.user) { location.replace('/login'); return; }
  const result = await api('/dashboard');
  app.innerHTML = `<div class="page-heading"><span class="eyebrow">Your plans, in one place</span><h1>Hello, ${escape(session.user.name)}.</h1><p>Find a time, share a plan, and get together.</p></div>${session.emailPreview ? '<div class="notice-box">Local preview — emails are captured for testing. Real inbox delivery will be enabled with your hosting email settings.</div>' : !session.emailEnabled ? '<div class="notice-box">Email delivery is not configured on this installation yet. Meetings and responses are saved, but email updates and password recovery need SMTP setup.</div>' : !session.user.verified ? '<div class="notice-box">Check your inbox to verify your email. <button class="text-button" id="resend">Send verification again</button></div>' : ''}<div class="availability-toolbar"><h2>My meetings</h2><a class="button" href="/new">+ Create a meeting</a></div>${result.meetings.length ? `<div class="meeting-list">${result.meetings.map(m => `<a class="meeting-item" href="/m/${m.id}"><span class="badge">${m.owner_id === session.user.id ? 'Organizing' : 'Participating'}</span><h3>${escape(m.title)}</h3><p>${m.scheduled_date ? day(m.scheduled_date) + ' · ' + clock(Number(m.scheduled_start)) : 'Finding a time'}</p><p>${escape(m.zone)}</p></a>`).join('')}</div>` : '<div class="empty"><span class="step-number">▦</span><h2>Your next meeting belongs here.</h2><p>Create a meeting and invite your group to find a shared time.</p><a class="button" href="/new">Create your first meeting →</a></div>'}`;
  document.querySelector('#resend')?.addEventListener('click', async event => {
    event.target.disabled = true;
    try { const result = await api('/auth/resend', {}); notice(result.message); }
    catch (error) { notice(error.message); }
    finally { event.target.disabled = false; }
  });
}
function timeOptions(selected, first = 0, last = 48) {
  return Array.from({length:last-first+1}, (_, i) => i+first).map(n => `<option value="${n}" ${n === selected ? 'selected' : ''}>${clock(n)}</option>`).join('');
}
function createPage() {
  if (!session.user) { location.replace('/register'); return; }
  const dates = new Set();
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  app.innerHTML = `<div class="page-heading"><span class="eyebrow">Something to look forward to</span><h1>Plan your next meeting.</h1><p>A few details now. A time that works for everyone next.</p></div><div class="form-layout"><form class="card" id="create"><div class="field"><label for="title">What are you planning?</label><input id="title" placeholder="e.g. Friday project catch-up" required maxlength="100"></div><div class="field"><label for="description">Description or location <span class="muted">(optional)</span></label><textarea id="description" maxlength="1000" placeholder="A little context for your group"></textarea></div><div class="field"><label for="date">Which dates could work?</label><div class="date-add"><input id="date" type="date"><button id="add-date" class="secondary" type="button">Add date</button></div><div id="dates" class="chips"></div><p class="muted">Select up to 14 dates.</p></div><div class="row"><div class="field"><label for="start">Earliest time</label><select id="start">${timeOptions(18,0,47)}</select></div><div class="field"><label for="end">Latest time</label><select id="end">${timeOptions(34,1,48)}</select></div></div><div class="row"><div class="field"><label for="duration">Meeting length</label><select id="duration"><option value="1">30 minutes</option><option value="2" selected>1 hour</option><option value="3">1 hour 30 minutes</option><option value="4">2 hours</option></select></div><div class="field"><label for="zone">Meeting timezone</label><select id="zone">${[...new Set([zone,...Intl.supportedValuesOf('timeZone')])].map(z => `<option ${z === zone ? 'selected' : ''}>${escape(z)}</option>`).join('')}</select></div></div><p class="form-error" id="form-error" role="alert"></p><button class="primary" type="submit">Create meeting & get a link →</button><p class="muted">Anyone with the invitation link can see names and availability. Emails stay private.</p></form><aside><span class="step-number">▦</span><h2>Good plans start with options.</h2><p>Choose a few dates and a time window. Your group can then mark the times they’re free.</p><p>Once everyone has responded, confirm your preferred time and send an email update to the group.</p><hr><p>Organizing as<br><strong>${escape(session.user.name)}</strong><br>${escape(session.user.email)}</p></aside></div>`;
  function renderDates() {
    document.querySelector('#dates').innerHTML = [...dates].sort().map(d => `<button type="button" class="chip" data-date="${d}" aria-label="Remove ${day(d)}">${day(d)} ×</button>`).join('');
  }
  document.querySelector('#add-date').onclick = () => {
    const input = document.querySelector('#date');
    if (!input.value || !input.validity.valid) return notice('Choose a valid date first.');
    if (dates.size >= 14) return notice('Choose up to 14 dates.');
    dates.add(input.value); renderDates();
  };
  document.querySelector('#dates').onclick = event => {
    const button = event.target.closest('[data-date]');
    if (button) { dates.delete(button.dataset.date); renderDates(); }
  };
  document.querySelector('#create').onsubmit = async event => {
    event.preventDefault();
    const button = event.target.querySelector('[type=submit]'); button.disabled = true;
    try {
      const value = id => document.getElementById(id).value;
      const result = await api('/meetings', {title:value('title'),description:value('description'),dates:[...dates],start:Number(value('start')),end:Number(value('end')),duration:Number(value('duration')),zone:value('zone')});
      location.href = '/m/' + result.id;
    } catch (error) { document.querySelector('#form-error').textContent = error.message; button.disabled = false; }
  };
}
function rankedTimes() {
  const results = [];
  const responses = meeting.responses.map(r => new Set(r.slots));
  for (const date of meeting.dates) {
    for (let start = meeting.start; start <= meeting.end-meeting.duration; start++) {
      const count = responses.filter(slots => Array.from({length:meeting.duration}, (_,i) => `${date}/${start+i}`).every(s => slots.has(s))).length;
      if (count) results.push({date,start,count});
    }
  }
  return results.sort((a,b) => b.count-a.count || a.date.localeCompare(b.date) || a.start-b.start).slice(0,3);
}
function captureDetails() {
  if (mode === 'edit') {
    identity.name = document.querySelector('#name').value;
    identity.email = document.querySelector('#email').value;
  }
}
function calendar() {
  const counts = new Map();
  meeting.responses.forEach(r => r.slots.forEach(slot => counts.set(slot,(counts.get(slot)||0)+1)));
  const headers = meeting.dates.map(d => `<th scope="col">${dateObject(d).toLocaleDateString('en-GB',{weekday:'short',timeZone:'UTC'}).toUpperCase()}<strong>${dateObject(d).getUTCDate()}</strong></th>`).join('');
  let rows = '';
  for (let time = meeting.start; time < meeting.end; time++) {
    rows += `<tr><th scope="row" class="time">${time % 2 === 0 || time === meeting.start ? clock(time) : ''}</th>`;
    for (const date of meeting.dates) {
      const slot = `${date}/${time}`, count = counts.get(slot)||0;
      const level = count ? Math.max(1,Math.ceil(count/meeting.responses.length*4)) : 0;
      rows += mode === 'edit'
        ? `<td><button type="button" class="slot ${selected.has(slot)?'selected':''}" data-slot="${slot}" aria-pressed="${selected.has(slot)}" aria-label="${day(date)} ${clock(time)}"></button></td>`
        : `<td><button type="button" class="slot level${level}" data-inspect="${slot}" aria-label="${day(date)} ${clock(time)}, ${count} of ${meeting.responses.length} available"><span class="heat-count">${count}</span></button></td>`;
    }
    rows += '</tr>';
  }
  return `<div class="grid-scroll"><table class="availability-table"><thead><tr><th scope="col">${escape(meeting.zone.split('/').pop())}</th>${headers}</tr></thead><tbody>${rows}</tbody></table></div>`;
}
function renderMeeting() {
  app.className = 'meeting-page';
  const existing = meeting.responses.some(r => r.id === identity.id);
  const canOrganize = meeting.canOrganize || organizerKey;
  app.innerHTML = `<section class="meeting-heading"><div><h1>${escape(meeting.title)}</h1><p>${escape(meeting.description || 'Find a time that works for your group.')}</p></div><div class="actions"><span class="people-count">♧ ${meeting.responses.length}</span><button id="share" class="secondary small">Share ↗</button></div></section>${meeting.scheduled_date ? `<div class="scheduled-banner"><span>✓ <strong>${day(meeting.scheduled_date)} · ${clock(meeting.scheduled_start)} – ${clock(meeting.scheduled_start+meeting.duration)}</strong></span><span>${escape(meeting.zone)}</span></div>` : ''}<div class="availability-toolbar"><h2>${mode === 'edit' ? 'Your availability' : 'Availabilities'}</h2><div class="toolbar-buttons"><button id="schedule-toggle" class="secondary small">Schedule ▦</button><button id="mode-toggle" class="small">${mode === 'edit' ? 'View group results' : existing ? 'Edit availability ✎' : 'Add availability ＋'}</button></div></div><div id="schedule-container"></div><div class="meeting-layout"><section>${mode === 'edit' ? `<div class="edit-details"><div><label for="name">Your name</label><input id="name" maxlength="60" required value="${escape(identity.name || session.user?.name || '')}" autocomplete="name"></div><div><label for="email">Your email</label><input id="email" type="email" maxlength="254" required value="${escape(identity.email || session.user?.email || '')}" autocomplete="email"></div></div><p class="edit-help muted">Select or drag across 30-minute slots when you’re free. Your email is private and receives meeting updates.</p>` : ''}<h3 class="calendar-month">${dateObject(meeting.dates[0]).toLocaleDateString('en-GB',{month:'long',year:'numeric',timeZone:'UTC'})}</h3>${calendar()}${mode === 'edit' ? `<div class="edit-actions"><p><span id="selection">${selected.size}</span> slots selected · <button type="button" id="clear" class="text-button">Clear selection</button></p><button id="save">${existing ? 'Update' : 'Save'} availability</button></div><p class="muted edit-help">You can edit your response later from this browser${session.user ? ' or your account' : ''}, or using the private link emailed to you.</p>` : '<div class="legend">Less<i></i><i></i><i></i><i></i><i></i>More available</div>'}<p class="timezone-note">All times in ${escape(meeting.zone)} · ${meeting.duration*30}-minute meeting</p><p class="muted" id="slot-detail" role="status"></p>${mode === 'results' ? '<button id="refresh" class="text-button small">↻ Refresh responses</button>' : ''}</section><aside class="responders"><div><h3>Responders (${meeting.responses.length})</h3>${meeting.responses.map(r => `<div class="person"><span class="avatar">${escape(r.name.slice(0,1).toUpperCase())}</span><span>${escape(r.name)}${r.id === identity.id ? ' (you)' : ''}</span></div>`).join('') || '<p class="muted">Share your link and invite the first response.</p>'}</div><div class="best-times"><h3>Best times</h3>${rankedTimes().map(r => `<div class="best"><strong>${day(r.date)}</strong>${clock(r.start)} – ${clock(r.start+meeting.duration)}<span>${r.count} of ${meeting.responses.length} available${r.count === meeting.responses.length ? ' · Everyone' : ''}</span></div>`).join('') || '<p class="muted">Shared times appear as people respond.</p>'}</div></aside></div>${meeting.emailPreview ? '<p class="notice-box">Local preview — email updates are captured for testing and are not sent to real inboxes.</p>' : !meeting.emailEnabled ? '<p class="notice-box">Email delivery is not configured yet. Your response and confirmed meeting time are saved here.</p>' : ''}`;
  document.querySelector('#share').onclick = () => copyLink(location.origin+location.pathname, 'Invitation link copied. Share it with your group.');
  document.querySelector('#mode-toggle').onclick = () => { captureDetails(); mode = mode === 'edit' ? 'results' : 'edit'; renderMeeting(); };
  document.querySelector('#schedule-toggle').onclick = () => { captureDetails(); showSchedule = !showSchedule; renderMeeting(); };
  if (showSchedule) renderSchedule(canOrganize);
  if (mode === 'edit') bindAvailability();
  else {
    document.querySelector('#refresh').onclick = async event => {
      event.target.disabled = true;
      try { meeting = await api('/meetings/'+meetingId); renderMeeting(); notice('Responses updated.'); }
      catch (error) { notice(error.message); event.target.disabled = false; }
    };
    document.querySelectorAll('[data-inspect]').forEach(button => button.onclick = () => {
      const names = meeting.responses.filter(r => r.slots.includes(button.dataset.inspect)).map(r => r.name);
      document.querySelector('#slot-detail').textContent = names.length ? 'Available at this time — ' + names.join(', ') : 'No one has marked this time yet.';
    });
  }
}
async function copyLink(link, message) {
  try { await navigator.clipboard.writeText(link); notice(message); }
  catch { prompt('Copy this link', link); }
}
function bindAvailability() {
  document.querySelector('#name').oninput = document.querySelector('#email').oninput = () => { dirty = true; };
  let dragging = false, adding = true;
  function paint(button) {
    if (adding) selected.add(button.dataset.slot); else selected.delete(button.dataset.slot);
    button.classList.toggle('selected', selected.has(button.dataset.slot));
    button.setAttribute('aria-pressed', selected.has(button.dataset.slot));
    document.querySelector('#selection').textContent = selected.size;
    dirty = true;
  }
  document.querySelectorAll('[data-slot]').forEach(button => {
    button.onpointerdown = event => {
      if (event.pointerType !== 'mouse' || event.button !== 0) return;
      event.preventDefault(); button.focus(); dragging = true; adding = !selected.has(button.dataset.slot); paint(button);
    };
    button.onpointerenter = event => { if (dragging && event.buttons === 1) paint(button); };
    button.onclick = event => {
      if (event.detail === 0 || event.pointerType === 'touch' || event.pointerType === 'pen') { adding = !selected.has(button.dataset.slot); paint(button); }
    };
  });
  window.onpointerup = () => { dragging = false; };
  document.querySelector('#clear').onclick = () => { captureDetails(); selected.clear(); dirty = true; renderMeeting(); };
  document.querySelector('#save').onclick = async event => {
    const name = document.querySelector('#name'), email = document.querySelector('#email');
    if (!name.reportValidity() || !email.reportValidity()) return;
    captureDetails(); event.target.disabled = true;
    try {
      const result = await api('/meetings/'+meetingId+'/responses',{name:identity.name,email:identity.email,secret:identity.secret,slots:[...selected]});
      identity.id = result.id; writeLocal('scheduler:'+meetingId,identity); dirty = false;
      meeting = await api('/meetings/'+meetingId); mode = 'results'; renderMeeting();
      notice(result.emailEnabled ? 'Availability saved. Your group can now see it.' : 'Availability saved. Email delivery still needs setup.');
    } catch (error) { notice(error.message); event.target.disabled = false; }
  };
}
function renderSchedule(canOrganize) {
  const container = document.querySelector('#schedule-container');
  container.className = 'schedule-panel';
  if (!canOrganize) {
    container.innerHTML = `<h2>Meeting time</h2><p>${meeting.scheduled_date ? `${day(meeting.scheduled_date)} · ${clock(meeting.scheduled_start)} (${escape(meeting.zone)})` : 'The organizer will confirm a time once the group has responded.'}</p>${!meeting.hasOrganizer ? '<p class="muted">This meeting was created in the earlier prototype. Create a new meeting from your account to use organizer controls.</p>' : '<p class="muted">If you organized this meeting, log in to your account to confirm or change the time.</p>'}`;
    return;
  }
  container.innerHTML = `<h2>${meeting.scheduled_date ? 'Change the scheduled time' : 'Choose the meeting time'}</h2><p class="muted">Confirm a ${meeting.duration*30}-minute time in ${escape(meeting.zone)}. The group will receive an email update when delivery is configured.</p><form id="schedule"><div class="row"><div><label for="schedule-date">Date</label><select id="schedule-date">${meeting.dates.map(d => `<option value="${d}" ${d === meeting.scheduled_date ? 'selected' : ''}>${day(d)}</option>`).join('')}</select></div><div><label for="schedule-time">Start time</label><select id="schedule-time">${timeOptions(meeting.scheduled_start ?? meeting.start,meeting.start,meeting.end-meeting.duration)}</select></div></div><button type="submit" class="small primary">Confirm time & notify group</button></form>`;
  document.querySelector('#schedule').onsubmit = async event => {
    event.preventDefault(); const button = event.target.querySelector('button'); button.disabled = true;
    try {
      const result = await api('/meetings/'+meetingId+'/schedule',{organizerKey,date:document.querySelector('#schedule-date').value,start:Number(document.querySelector('#schedule-time').value)});
      captureDetails(); meeting = await api('/meetings/'+meetingId); showSchedule = false; renderMeeting();
      notice(result.emailEnabled ? 'Meeting time confirmed. Email updates queued.' : 'Meeting time confirmed. Email delivery needs setup.');
    } catch (error) { notice(error.message); button.disabled = false; }
  };
}
async function meetingPage() {
  meeting = await api('/meetings/'+meetingId);
  const fragment = new URLSearchParams(location.hash.slice(1));
  organizerKey = fragment.get('organizer') || readLocal('organizer:'+meetingId);
  if (organizerKey) writeLocal('organizer:'+meetingId,organizerKey);
  identity = readLocal('scheduler:'+meetingId) || {secret:Array.from(crypto.getRandomValues(new Uint8Array(24)),b => b.toString(16).padStart(2,'0')).join('')};
  const secret = fragment.get('edit') || identity.secret;
  if (fragment.has('edit') || identity.id || session.user) {
    try {
      const response = await api('/meetings/'+meetingId+'/identity',{secret});
      identity = {secret,id:response.id,name:response.name,email:response.email};
    } catch (error) { if (error.status !== 404 || fragment.has('edit')) throw error; }
  }
  if (fragment.has('edit')) mode = 'edit';
  history.replaceState(null,'',location.pathname);
  writeLocal('scheduler:'+meetingId,identity);
  selected = new Set(meeting.responses.find(r => r.id === identity.id)?.slots || []);
  renderMeeting();
}
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
try {
  session = await api('/auth/session');
  navigation();
  const page = location.pathname.replace(/^\/+|\/+$/g,'');
  if (meetingId) await meetingPage();
  else if (['login','register','forgot','reset','verify'].includes(page)) authPage(page);
  else if (page === 'new') createPage();
  else if (page === 'dashboard') await dashboardPage();
  else if (!page) landingPage();
  else app.innerHTML = '<div class="empty"><h1>Page not found</h1><a class="button" href="/">Back home</a></div>';
} catch (error) {
  app.innerHTML = `<section class="auth-layout card"><h2>Unable to open this page</h2><p>${escape(error.message)}</p><a class="button" href="/">Try again</a></section>`;
}
