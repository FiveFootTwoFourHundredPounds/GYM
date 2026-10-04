const $ = (s, r = document) => r.querySelector(s);
const view = $('#view');
let ME = null;

const api = async (url, opts = {}) => {
  const res = await fetch('/api' + url, { credentials: 'same-origin', ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
};
const post = (u, b) => api(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
const form = (u, fd, m = 'POST') => api(u, { method: m, body: fd });
const esc = (s) => String(s ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const av = (u, cls = '') => u.avatar
  ? `<img class="avatar ${cls}" src="${u.avatar}" alt="">`
  : `<div class="avatar ${cls}">${esc((u.display_name || u.username)[0].toUpperCase())}</div>`;
const list = (a, empty = '—') => (a?.length ? `<ul class="clean">${a.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : `<p class="muted">${empty}</p>`);

/* ---------- auth gate ---------- */
let mode = 'login';
$('#authTabs').onclick = e => {
  if (!e.target.dataset.m) return;
  mode = e.target.dataset.m;
  [...$('#authTabs').children].forEach(t => t.classList.toggle('active', t.dataset.m === mode));
  $('.reg-only').classList.toggle('hide', mode !== 'register');
};
$('#authForm').onsubmit = async e => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  try { await post('/' + mode, f); location.reload(); }
  catch (err) { $('#authErr').textContent = err.message; }
};

/* ---------- router ---------- */
const routes = {};
async function route() {
  const [, name, arg] = (location.hash || '#/home').split('/');
  const fn = routes[name] || routes.home;
  [...$('#nav').children].forEach(a => a.classList.toggle('on', a.hash.startsWith('#/' + name)));
  view.innerHTML = '<p class="muted"><span class="spin"></span> loading…</p>';
  try { await fn(arg); } catch (e) { view.innerHTML = `<div class="card"><p class="err">${esc(e.message)}</p></div>`; }
}
addEventListener('hashchange', route);

/* ---------- views ---------- */
routes.home = async () => {
  const [s, latest, w] = await Promise.all([api('/stats/today'), api('/review/latest?kind=day'), api('/weights')]);
  const last = w.at(-1);
  view.innerHTML = `
  <h2>Today</h2><p class="sub">${s.day} · ${ME.streak} day streak · Level ${ME.level} ${ME.rank}</p>
  <div class="grid g3" style="margin-bottom:16px">
    ${[['Calories', s.calories], ['Protein', s.protein_g + 'g'], ['Meals', s.meals],
       ['Training', s.training_minutes + 'm'], ['Weight', last ? last.weight_kg + 'kg' : '—'], ['XP', ME.xp]]
      .map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join('')}
  </div>
  <div class="grid g2">
    <div class="card"><h3>Quick log</h3>
      <form id="qm" class="row" style="margin-bottom:14px">
        <select name="meal_type" style="width:auto;margin:0">
          <option>breakfast</option><option>lunch</option><option>dinner</option><option>snack</option>
        </select>
        <input type="file" name="image" accept="image/*" style="margin:0;flex:1" required>
        <button class="btn sm">Log meal</button>
      </form>
      <form id="qw" class="row" style="margin-bottom:14px">
        <input name="title" placeholder="Push day" style="margin:0;flex:1" required>
        <input name="duration_min" type="number" value="60" style="margin:0;width:78px">
        <button class="btn sm">Log workout</button>
      </form>
      <form id="qwt" class="row">
        <input name="weight_kg" type="number" step="0.1" placeholder="weight kg" style="margin:0;flex:1" required>
        <button class="btn sm">Save weight</button>
      </form>
    </div>
    <div class="card"><div class="spread"><h3>AI daily review</h3>
      <button class="btn sm" id="runDay">Analyse my day</button></div>
      <div id="dayOut" style="margin-top:12px">${latest ? reviewHtml(latest.content, latest.day) : '<p class="muted">No review yet. Log some meals and training, then run it.</p>'}</div>
    </div>
  </div>`;

  $('#qm').onsubmit = async e => { e.preventDefault(); await form('/meals', new FormData(e.target)); location.hash = '#/meals'; };
  $('#qw').onsubmit = async e => { e.preventDefault(); await form('/workouts', new FormData(e.target)); route(); };
  $('#qwt').onsubmit = async e => { e.preventDefault(); await post('/weights', Object.fromEntries(new FormData(e.target))); route(); };
  $('#runDay').onclick = async (e) => {
    e.target.disabled = true; $('#dayOut').innerHTML = '<p class="muted"><span class="spin"></span> the coach is thinking…</p>';
    try { $('#dayOut').innerHTML = reviewHtml(await post('/review/day'), 'just now'); }
    catch (err) { $('#dayOut').innerHTML = `<p class="err">${esc(err.message)}</p>`; }
    e.target.disabled = false; loadMe();
  };
};

const reviewHtml = (a, when) => `
  <div class="spread"><b style="font-size:17px">${esc(a.headline || 'Daily review')}</b>
    <span class="pill">score ${a.score ?? '—'}/100 · ${esc(when)}</span></div>
  <p class="muted" style="margin:8px 0 12px">${esc(a.summary || a._raw || '')}</p>
  <div class="grid g2">
    <div><h3 style="color:var(--good)">Wins</h3>${list(a.wins)}</div>
    <div><h3 style="color:var(--warn)">Fix</h3>${list(a.fixes)}</div>
  </div>
  ${a.tomorrow ? `<h3 style="margin-top:14px">Tomorrow</h3>${list(a.tomorrow)}` : ''}
  ${a.motivation ? `<p style="margin-top:12px;font-style:italic">"${esc(a.motivation)}"</p>` : ''}`;

routes.meals = async () => {
  const meals = await api('/meals');
  const sum = meals.reduce((t, m) => ({ k: t.k + (m.calories || 0), p: t.p + (m.protein || 0) }), { k: 0, p: 0 });
  view.innerHTML = `
  <h2>Meals</h2><p class="sub">${Math.round(sum.k)} kcal · ${Math.round(sum.p)}g protein today</p>
  <div class="card"><form id="mf" class="row">
    <select name="meal_type" style="width:auto;margin:0"><option>breakfast</option><option>lunch</option><option>dinner</option><option>snack</option></select>
    <input type="file" name="image" accept="image/*" capture="environment" style="margin:0;flex:1" required>
    <input name="note" placeholder="note (optional)" style="margin:0;flex:1">
    <button class="btn primary sm" style="width:auto">Analyse</button>
  </form></div>
  ${meals.map(mealCard).join('') || '<p class="muted">No meals logged today.</p>'}`;
  $('#mf').onsubmit = async e => { e.preventDefault(); await form('/meals', new FormData(e.target)); route(); setTimeout(route, 9000); };
  view.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { await api('/meals/' + b.dataset.del, { method: 'DELETE' }); route(); });
};

function mealCard(m) {
  const a = m.ai_json ? JSON.parse(m.ai_json) : null;
  const body = m.status === 'pending' ? '<p class="muted"><span class="spin"></span> AI is analysing…</p>'
    : m.status === 'error' ? `<p class="err">${esc(a?.error || 'Analysis failed')}</p>`
    : `<p class="muted" style="font-size:13px">${esc(a?.verdict || '')}</p>
       <div class="macros"><span>${Math.round(m.calories)} kcal</span><span>P ${Math.round(m.protein)}g</span>
       <span>C ${Math.round(m.carbs)}g</span><span>F ${Math.round(m.fat)}g</span>
       <span>confidence: ${esc(a?.confidence || '?')}</span></div>
       ${a?.swap ? `<p style="font-size:13px;margin-top:6px">↻ ${esc(a.swap)}</p>` : ''}`;
  return `<div class="meal">
    ${m.image ? `<img src="${m.image}" alt="">` : ''}
    <div style="flex:1">
      <div class="spread"><b>${esc(m.title || m.meal_type)}</b>
        <span class="row"><span class="tag">${esc(m.meal_type)}</span>
        <button class="btn sm ghost" data-del="${m.id}">×</button></span></div>
      ${body}
    </div></div>`;
}

routes.gym = async () => {
  const w = await api('/workouts');
  view.innerHTML = `
  <h2>Gym log</h2><p class="sub">${w.length} sessions recorded</p>
  <div class="card"><form id="wf">
    <div class="row">
      <input name="title" placeholder="Session name (Push / Legs / Pull)" style="flex:2;margin:0" required>
      <input name="duration_min" type="number" value="60" style="width:90px;margin:0">
      <select name="intensity" style="width:auto;margin:0"><option>light</option><option selected>moderate</option><option>hard</option></select>
    </div>
    <div class="row" style="margin-top:10px">
      <input name="note" placeholder="Bench 4x8 @80kg…" style="flex:2;margin:0">
      <input type="file" name="image" accept="image/*" style="flex:1;margin:0">
      <button class="btn primary sm" style="width:auto">Log session</button>
    </div>
  </form></div>
  <div class="grid g3">${w.map(x => `
    <div class="card" style="padding:12px">
      ${x.image ? `<img class="thumb" src="${x.image}" style="margin-bottom:9px" alt="">` : ''}
      <div class="spread"><b>${esc(x.title)}</b><span class="tag">${esc(x.intensity)}</span></div>
      <p class="muted" style="font-size:12px">${x.day} · ${x.duration_min} min</p>
      ${x.note ? `<p style="font-size:13px;margin-top:6px">${esc(x.note)}</p>` : ''}
    </div>`).join('') || '<p class="muted">Nothing yet.</p>'}</div>`;
  $('#wf').onsubmit = async e => { e.preventDefault(); await form('/workouts', new FormData(e.target)); route(); loadMe(); };
};

routes.plans = async () => {
  const p = await api('/plans');
  view.innerHTML = `
  <h2>Training plans</h2><p class="sub">Write your split, let the AI audit it</p>
  <div class="card"><form id="pf">
    <div class="row"><input name="title" placeholder="Plan name" style="flex:2;margin:0" required>
      <select name="goal" style="width:auto;margin:0"><option>hypertrophy</option><option>strength</option><option>fat loss</option><option>general</option></select>
      <input name="days_per_week" type="number" value="4" min="1" max="7" style="width:80px;margin:0"></div>
    <textarea name="content" style="margin-top:10px" placeholder="Mon – Push
  Bench press 4x6-8
  Incline DB press 3x10
..."></textarea>
    <div class="row"><input type="file" name="image" accept="image/*" style="flex:1;margin:0">
      <button class="btn primary sm" style="width:auto">Save plan</button></div>
  </form></div>
  ${p.map(planCard).join('')}`;
  $('#pf').onsubmit = async e => { e.preventDefault(); await form('/plans', new FormData(e.target)); route(); };
  view.querySelectorAll('[data-an]').forEach(b => b.onclick = async () => {
    b.disabled = true; b.innerHTML = '<span class="spin"></span> analysing';
    try { await post(`/plans/${b.dataset.an}/analyze`); route(); } catch (e) { alert(e.message); b.disabled = false; }
  });
  view.querySelectorAll('[data-pdel]').forEach(b => b.onclick = async () => { await api('/plans/' + b.dataset.pdel, { method: 'DELETE' }); route(); });
};

function planCard(p) {
  const a = p.ai_json ? JSON.parse(p.ai_json) : null;
  const mb = a?.muscle_balance ? Object.entries(a.muscle_balance)
    .map(([k, v]) => `<span class="tag" style="color:${v === 'ok' ? 'var(--good)' : v === 'low' ? 'var(--bad)' : 'var(--warn)'}">${k}: ${v}</span>`).join(' ') : '';
  return `<div class="card">
    <div class="spread"><div><b>${esc(p.title)}</b> <span class="pill">${esc(p.goal)} · ${p.days_per_week}d/wk</span></div>
      <span class="row"><button class="btn sm" data-an="${p.id}">${a ? 'Re-analyse' : 'AI analyse'}</button>
      <button class="btn sm ghost" data-pdel="${p.id}">×</button></span></div>
    ${p.image ? `<img src="${p.image}" style="max-width:220px;border-radius:10px;margin-top:10px" alt="">` : ''}
    <pre style="white-space:pre-wrap;font-size:13px;color:var(--muted);margin:10px 0">${esc(p.content)}</pre>
    ${a ? `<hr style="border:0;border-top:1px solid var(--line);margin:12px 0">
      <div class="spread"><b>AI audit — ${esc(a.split_type || '')}</b><span class="pill">score ${a.score ?? '—'}/100 · ~${a.weekly_sets_estimate ?? '?'} sets/wk</span></div>
      <p class="muted" style="margin:8px 0">${esc(a.summary || a._raw || '')}</p>
      <div class="row" style="margin-bottom:10px">${mb}</div>
      <div class="grid g2"><div><h3 style="color:var(--good)">Strengths</h3>${list(a.strengths)}</div>
        <div><h3 style="color:var(--bad)">Gaps</h3>${list(a.gaps)}</div></div>
      ${a.fixes?.length ? `<h3 style="margin-top:12px">Fixes</h3>${list(a.fixes.map(f => `${f.change} — ${f.why}`))}` : ''}
      ${a.progression_advice ? `<p style="margin-top:10px;font-size:13px">📈 ${esc(a.progression_advice)}</p>` : ''}` : ''}
  </div>`;
}

routes.coach = async () => {
  const [latest, w] = await Promise.all([api('/review/latest?kind=coach'), api('/weights')]);
  view.innerHTML = `
  <h2>Coach</h2><p class="sub">Bulk, cut or maintain — decided from your own data</p>
  ${sparkline(w)}
  <div class="row" style="margin:16px 0"><button class="btn primary sm" id="run" style="width:auto">Get my verdict</button>
    <span class="muted" style="font-size:13px">Needs ~2 weeks of weigh-ins for a confident call.</span></div>
  <div id="out">${latest ? coachHtml(latest.content) : '<p class="muted">No verdict yet.</p>'}</div>`;
  $('#run').onclick = async e => {
    e.target.disabled = true; $('#out').innerHTML = '<p class="muted"><span class="spin"></span> crunching your trend…</p>';
    try { $('#out').innerHTML = coachHtml(await post('/review/coach')); } catch (er) { $('#out').innerHTML = `<p class="err">${esc(er.message)}</p>`; }
    e.target.disabled = false;
  };
};

function coachHtml(a) {
  const rec = (a.recommendation || 'maintain').toLowerCase();
  return `<div class="verdict"><span class="muted">RECOMMENDATION</span>
    <b class="${rec}">${esc(rec)}</b>
    <span class="pill">confidence: ${esc(a.confidence || '?')} · trend ${a.weight_trend_kg_per_week ?? 0} kg/week</span>
    <p style="max-width:620px;margin:14px auto 0">${esc(a.reasoning || a._raw || '')}</p></div>
  <div class="grid g3" style="margin-top:16px">
    ${[['kcal/day', a.calorie_target], ['protein', a.protein_target_g + 'g'], ['carbs', a.carb_target_g + 'g'],
       ['fat', a.fat_target_g + 'g'], ['check-in', (a.checkin_in_weeks ?? 4) + ' wks']]
      .map(([k, v]) => `<div class="stat"><b>${v ?? '—'}</b><span>${k}</span></div>`).join('')}
  </div>
  <div class="grid g2" style="margin-top:16px">
    <div class="card"><h3>Next steps</h3>${list(a.next_steps)}</div>
    <div class="card"><h3>Watch out for</h3>${list(a.watch_out_for)}
      ${a.training_focus ? `<p style="margin-top:10px;font-size:13px"><b>Training:</b> ${esc(a.training_focus)}</p>` : ''}
      ${a.cardio ? `<p style="font-size:13px"><b>Cardio:</b> ${esc(a.cardio)}</p>` : ''}</div>
  </div>`;
}

function sparkline(w) {
  if (w.length < 2) return '<div class="card"><p class="muted">Log weight daily to unlock the trend chart.</p></div>';
  const v = w.slice(-60).map(x => x.weight_kg), mn = Math.min(...v), mx = Math.max(...v), rg = mx - mn || 1;
  const pts = v.map((y, i) => `${(i / (v.length - 1)) * 100},${34 - ((y - mn) / rg) * 30}`).join(' ');
  return `<div class="card"><div class="spread"><h3>Weight trend</h3>
    <span class="pill">${v.at(-1)}kg · ${(v.at(-1) - v[0] >= 0 ? '+' : '')}${(v.at(-1) - v[0]).toFixed(1)}kg</span></div>
    <svg viewBox="0 0 100 36" preserveAspectRatio="none" style="width:100%;height:110px;margin-top:8px">
      <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="1" vector-effect="non-scaling-stroke"/>
    </svg><p class="muted" style="font-size:12px">${mn}kg – ${mx}kg over ${v.length} entries</p></div>`;
}

routes.board = async (range = 'week') => {
  const rows = await api('/leaderboard?range=' + range);
  const key = range === 'all' ? 'xp' : 'period_xp';
  const top = rows.slice(0, 3), rest = rows.slice(3);
  view.innerHTML = `
  <div class="spread"><div><h2>Leaderboard</h2><p class="sub">Climb by logging meals, training and reviews</p></div>
    <div class="row">${['week', 'month', 'all'].map(x =>
      `<a href="#/board/${x}" class="btn sm ${x === range ? 'primary' : ''}" style="width:auto">${x}</a>`).join('')}</div></div>
  <div class="podium">${[1, 0, 2].map(i => top[i] ? `
    <a href="#/u/${top[i].username}" class="pod ${i === 0 ? 'p1' : ''}" style="--c:${top[i].rankColor}">
      <div class="crown">${['👑', '🥈', '🥉'][i]}</div>
      <div style="display:flex;justify-content:center;margin:8px 0">${av(top[i], 'lg')}</div>
      <b>${esc(top[i].display_name)}</b>
      <div class="badge" style="color:${top[i].rankColor};margin:6px 0">${top[i].rank} ${top[i].level}</div>
      <div class="xpv" style="font-size:19px">${top[i][key].toLocaleString()} XP</div>
      <span class="muted" style="font-size:12px">${top[i].sessions} sessions · 🔥${top[i].streak}</span>
    </a>` : '<div></div>').join('')}</div>
  ${rest.map(u => `
    <a href="#/u/${u.username}" class="lb-row ${u.id === ME.id ? 'you' : ''}" style="--c:${u.rankColor}">
      <div class="pos">#${u.rankPos}</div>${av(u)}
      <div><b>${esc(u.display_name)}</b> <span class="badge" style="color:${u.rankColor}">${u.rank} ${u.level}</span>
        <div class="bar"><i style="width:${u.pct}%"></i></div></div>
      <div style="text-align:right"><div class="xpv">${u[key].toLocaleString()}</div>
        <span class="muted" style="font-size:11px">🔥${u.streak} · ${u.sessions} sess</span></div>
    </a>`).join('')}`;
};

routes.me = () => { location.hash = '#/u/' + ME.username; };

routes.u = async (username) => {
  const u = await api('/users/' + username);
  const banners = { sunset: 'linear-gradient(120deg,#ff7a45,#c341a6)', ocean: 'linear-gradient(120deg,#0ea5e9,#4f46e5)',
    forest: 'linear-gradient(120deg,#16a34a,#065f46)', mono: 'linear-gradient(120deg,#334155,#0f172a)',
    gold: 'linear-gradient(120deg,#f59e0b,#b45309)' };
  view.innerHTML = `
  <div class="card" style="overflow:hidden">
    <div class="banner" style="background:${banners[u.banner] || banners.sunset}"></div>
    <div style="display:flex;gap:16px;align-items:flex-end;margin-top:-44px">
      ${av(u, 'lg')}
      <div style="flex:1;padding-bottom:4px">
        <div class="spread"><div>
          <b style="font-size:21px">${esc(u.display_name)}</b> <span class="muted">@${esc(u.username)}</span>
          <div class="row" style="margin-top:5px">
            <span class="badge" style="color:${u.rankColor}">${u.rank} · Lv ${u.level}</span>
            <span class="pill">${esc(u.title)}</span><span class="pill">🔥 ${u.streak} days</span>
            <span class="pill">🎯 ${esc(u.goal)}</span></div>
        </div>
        ${u.isSelf ? `<button class="btn sm" id="edit">Customise</button>`
                   : `<button class="btn sm primary" style="width:auto" id="cheer">👏 Cheer (${u.cheers})</button>`}</div>
      </div>
    </div>
    ${u.bio ? `<p style="margin-top:12px">${esc(u.bio)}</p>` : ''}
    <div class="bar" style="margin-top:14px"><i style="width:${u.pct}%"></i></div>
    <p class="muted" style="font-size:12px;margin-top:5px">${u.into} / ${u.need} XP to level ${u.level + 1} · ${u.xp.toLocaleString()} total</p>
  </div>
  <div class="grid g3" style="margin-bottom:16px">
    ${[['Sessions', u.totals.sessions], ['Minutes', u.totals.mins], ['XP this week', u.week_xp], ['Cheers', u.cheers]]
      .map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join('')}
  </div>
  <div id="editor"></div>
  <h3>Recent sessions</h3>
  <div class="grid g3" style="margin-bottom:20px">${u.recent.map(x => `
    <div class="card" style="padding:11px">${x.image ? `<img class="thumb" src="${x.image}" style="margin-bottom:8px">` : ''}
    <b>${esc(x.title)}</b><p class="muted" style="font-size:12px">${x.day} · ${x.duration_min}m</p></div>`).join('') || '<p class="muted">None yet.</p>'}</div>
  <h3>Meal gallery</h3>
  <div class="grid g3">${u.gallery.map(g => `
    <div class="card" style="padding:9px"><img class="thumb" src="${g.image}">
    <p style="font-size:12px;margin-top:6px">${esc(g.title || 'Meal')}<br><span class="muted">${g.day}</span></p></div>`).join('') || '<p class="muted">None yet.</p>'}</div>`;

  if (u.isSelf) $('#edit').onclick = () => renderEditor(u, banners);
  else $('#cheer').onclick = async e => {
    try { await post(`/users/${u.username}/cheer`); e.target.textContent = '👏 Cheered!'; e.target.disabled = true; }
    catch (err) { alert(err.message); }
  };
};

function renderEditor(u, banners) {
  $('#editor').innerHTML = `<div class="card"><h3>Customise profile</h3>
    <form id="pe" class="grid g2">
      <div><label>Display name</label><input name="display_name" value="${esc(u.display_name)}">
        <label>Custom title</label><input name="title" value="${esc(u.title)}" maxlength="24">
        <label>Bio</label><input name="bio" value="${esc(u.bio)}">
        <label>Accent colour</label><input type="color" name="accent" value="${u.accent}" style="height:42px;padding:4px">
        <label>Banner</label><select name="banner">${Object.keys(banners).map(b =>
          `<option ${b === u.banner ? 'selected' : ''}>${b}</option>`).join('')}</select></div>
      <div><label>Goal</label><select name="goal">${['bulk', 'cut', 'maintain', 'recomp'].map(g =>
          `<option ${g === u.goal ? 'selected' : ''}>${g}</option>`).join('')}</select>
        <label>Sex</label><select name="sex">${['unspecified', 'male', 'female'].map(s => `<option>${s}</option>`).join('')}</select>
        <label>Age</label><input name="age" type="number">
        <label>Height (cm)</label><input name="height_cm" type="number" step="0.5">
        <label>Activity</label><select name="activity">${['sedentary', 'light', 'moderate', 'high', 'athlete'].map(a => `<option>${a}</option>`).join('')}</select></div>
      <div class="row"><input type="file" id="avf" accept="image/*" style="margin:0;flex:1">
        <button class="btn primary sm" style="width:auto">Save</button></div>
    </form></div>`;
  $('#pe').onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if ($('#avf').files[0]) { const fd = new FormData(); fd.append('image', $('#avf').files[0]); await form('/me/avatar', fd); }
    await api('/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) });
    await loadMe(); route();
  };
}

/* ---------- boot ---------- */
async function loadMe() {
  ME = await api('/me');
  document.documentElement.style.setProperty('--accent', ME.accent);
  $('#meChip').innerHTML = `${av(ME)}<span><b>${esc(ME.display_name)}</b><br>
    <span style="color:${ME.rankColor};font-size:11px">${ME.rank} ${ME.level}</span></span>`;
}
(async () => {
  try { await loadMe(); $('#gate').classList.add('hide'); $('#shell').classList.remove('hide'); route(); }
  catch { $('#gate').classList.remove('hide'); }
})();