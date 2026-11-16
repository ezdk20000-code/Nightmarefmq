import { createStore } from './store.js';
import { Board, ARROW_COLORS } from './board.js';

// ───────────────────────── helpers ─────────────────────────
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nl = (s) => esc(s).replace(/\n/g, '<br>');
const clone = (o) => JSON.parse(JSON.stringify(o));
const fmtDate = (t) => t ? new Date(t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
const LOGIN_RE = /^[a-z0-9_.-]{3,24}$/;

const ACCESS = {
  leader: { name: 'Глава', cls: 'leader' },
  officer: { name: 'Офицер', cls: 'officer' },
  member: { name: 'Боец', cls: 'member' },
};

const SEED_ROLES = [
  { name: 'Командир', color: '#c4142b', icon: '👑', description: 'Принимает решения в бою, даёт сигналы на смену фазы.', duties: ['Следит за общей картиной', 'Объявляет переход между фазами', 'Решает, когда отступать'] },
  { name: 'Разведчик', color: '#3fd0ff', icon: '👁', description: 'Первым выходит вперёд и сообщает, что видит.', duties: ['Докладывает о противниках и угрозах', 'Проверяет маршрут перед командой'] },
  { name: 'Штурмовик', color: '#ff7a1a', icon: '⚔', description: 'Основная ударная сила, прорывает оборону.', duties: ['Идёт на прорыв по сигналу', 'Держит темп атаки'] },
  { name: 'Поддержка', color: '#7dff6a', icon: '✚', description: 'Помогает союзникам и закрывает слабые места.', duties: ['Страхует штурмовиков', 'Подбирает и прикрывает отставших'] },
  { name: 'Защитник', color: '#9b5cff', icon: '🛡', description: 'Держит ключевую точку и тылы.', duties: ['Не уходит с позиции без приказа', 'Предупреждает о заходе с фланга'] },
];

function toast(msg, kind = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.classList.add('out'), 2600);
  setTimeout(() => t.remove(), 3000);
}

function modal(html, mount) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
  $$('[data-close]', wrap).forEach((b) => b.addEventListener('click', close));
  const first = $('input,textarea,select', wrap);
  first && first.focus();
  mount && mount(wrap, close);
  return close;
}

function genPassword() {
  const a = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const r = new Uint32Array(10);
  crypto.getRandomValues(r);
  return [...r].map((x) => a[x % a.length]).join('');
}

async function busy(btn, fn) {
  const old = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = '…';
  try { return await fn(); } catch (e) { toast(e.message, 'err'); throw e; } finally { btn.disabled = false; btn.innerHTML = old; }
}

async function imageToDataUrl(file, maxW = 1400) {
  const img = await new Promise((res, rej) => {
    const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file);
  });
  let q = 0.8, w = Math.min(maxW, img.width), out;
  do {
    const c = document.createElement('canvas');
    c.width = w; c.height = Math.round(img.height * w / img.width);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    out = c.toDataURL('image/jpeg', q);
    q -= 0.1; if (q < 0.45) { w = Math.round(w * 0.8); q = 0.7; }
  } while (out.length > 850_000);
  return out;
}

// ───────────────────────── state ─────────────────────────
const COLLECTIONS = ['members', 'roles', 'tactics', 'maps', 'situations'];
let store;
const S = {
  user: null, setupDone: false, ready: false,
  members: [], roles: [], tactics: [], maps: [], situations: [],
  sitFilter: { q: '', cat: '', mode: 'cards', gaps: false },
  loaded: new Set(), unsubs: [],
  draft: null, phaseIdx: 0, viewPhase: 0, remoteChanged: false,
};

const me = () => S.members.find((m) => m.id === S.user?.uid);
const isLeader = () => me()?.access === 'leader';
const isEditor = () => ['leader', 'officer'].includes(me()?.access);
const roleOf = (m) => S.roles.find((r) => r.id === m?.roleId);
const member = (id) => S.members.find((m) => m.id === id);
const sortedMembers = () => [...S.members].sort((a, b) => {
  const o = { leader: 0, officer: 1, member: 2 };
  return (o[a.access] - o[b.access]) || a.nick.localeCompare(b.nick);
});
const tokenInfo = (uid) => {
  const m = member(uid);
  if (!m) return null;
  return { label: m.nick, color: roleOf(m)?.color || '#777', me: uid === S.user?.uid };
};
const mapImage = (id) => S.maps.find((m) => m.id === id)?.image || null;
const ackedCurrent = (t, uid) => (t.acks || {})[uid] === (t.version || 1);

function roleBadge(r) {
  if (!r) return '<span class="role-badge none">без роли</span>';
  return `<span class="role-badge" style="--c:${esc(r.color)}">${esc(r.icon || '')} ${esc(r.name)}</span>`;
}

// ───────────────────────── routing ─────────────────────────
function route() {
  const h = location.hash.replace(/^#\/?/, '') || 'brief';
  const [page, id, sub] = h.split('/');
  return { page, id, sub };
}
window.addEventListener('hashchange', () => {
  const r = route();
  if (r.sub !== 'edit') S.draft = null;
  render();
});

// ───────────────────────── boot ─────────────────────────
async function boot() {
  try {
    store = await createStore();
  } catch (e) {
    console.error(e);
    $('#app').innerHTML = `<div class="center-card"><h2>Не удалось загрузить Firebase</h2><p class="muted">${esc(e.message)}</p></div>`;
    return;
  }
  if (store.mode === 'local') $('#demo-banner').hidden = false;
  try { S.setupDone = await store.isSetupDone(); } catch (e) { toast(e.message, 'err'); }
  store.onAuth((u) => {
    S.unsubs.forEach((f) => f()); S.unsubs = []; S.loaded.clear();
    S.user = u; S.ready = true;
    if (u) {
      S.setupDone = true;
      for (const name of COLLECTIONS) {
        S.unsubs.push(store.subscribe(name, (rows) => {
          S[name] = rows; S.loaded.add(name);
          onData(name);
        }, (err) => {
          if (err.code === 'permission-denied') {
            toast('Доступ закрыт. Обратись к главе клана.', 'err');
            store.signOut();
          }
        }));
      }
    }
    render();
  });
}

function onData(name) {
  if (S.loaded.size < COLLECTIONS.length) return;
  if (!me()) {
    toast('Твой доступ отозван главой клана', 'err');
    store.signOut();
    return;
  }
  const r = route();
  if (r.sub === 'edit' && S.draft) {
    const col = S.draftKind === 'situation' ? 'situations' : 'tactics';
    if (name === col && S.draft.id) {
      const t = S[col].find((x) => x.id === S.draft.id);
      if (t && t.updatedAt !== S.draft.updatedAt && t.updatedBy !== S.user.uid) {
        S.remoteChanged = true;
        const b = $('#remote-warn'); if (b) b.hidden = false;
      }
    }
    renderNav();
    return; // не перерисовываем редактор, чтобы не потерять ввод
  }
  render();
}

// ───────────────────────── render root ─────────────────────────
function render() {
  const app = $('#app');
  if (!S.ready) { app.innerHTML = '<div class="loader">NIGHTMARE</div>'; return; }
  if (!S.user) { $('#nav').innerHTML = ''; return renderAuth(app); }
  if (S.loaded.size < COLLECTIONS.length || !me()) { app.innerHTML = '<div class="loader">NIGHTMARE</div>'; return; }
  renderNav();
  const r = route();
  const views = { brief: viewBrief, roster: viewRoster, roles: viewRoles, tactics: viewTactics, tactic: viewTactic, situations: viewSituations, situation: viewSituation, maps: viewMaps, profile: viewProfile };
  (views[r.page] || viewBrief)(app, r);
  window.scrollTo({ top: window.scrollY });
}

function renderNav() {
  const r = route().page;
  const m = me();
  const links = [['brief', 'Брифинг'], ['tactics', 'Тактики'], ['situations', 'Ситуации'], ['roster', 'Состав'], ['roles', 'Роли'], ['maps', 'Карты']];
  $('#nav').innerHTML = `
    ${links.map(([k, t]) => `<a href="#/${k}" class="${r === k || r === k.replace(/s$/, '') ? 'active' : ''}">${t}</a>`).join('')}
    <a href="#/profile" class="nav-me ${r === 'profile' ? 'active' : ''}"><span class="dot" style="--c:${esc(roleOf(m)?.color || '#777')}"></span>${esc(m?.nick)}</a>
    <button class="btn ghost sm" id="logout">Выйти</button>`;
  $('#logout').onclick = () => store.signOut();
}

// ───────────────────────── auth ─────────────────────────
function renderAuth(app) {
  if (!S.setupDone) {
    app.innerHTML = `
      <form class="center-card" id="setup">
        <div class="sigil">☠</div>
        <h1>Первый запуск</h1>
        <p class="muted">Создай аккаунт главы клана NIGHTMARE. Потом ты сам будешь выдавать логины и пароли остальным игрокам.</p>
        <label>Ник в игре<input name="nick" required maxlength="24" placeholder="Например: Shadow"></label>
        <label>Логин для входа<input name="login" required placeholder="латиница, цифры, _ . -" autocomplete="username"></label>
        <label>Пароль<input name="password" type="password" required minlength="6" autocomplete="new-password"></label>
        <label>Повтори пароль<input name="password2" type="password" required minlength="6" autocomplete="new-password"></label>
        <button class="btn primary wide">Создать клан</button>
      </form>`;
    $('#setup').onsubmit = (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      f.login = f.login.trim().toLowerCase();
      if (!LOGIN_RE.test(f.login)) return toast('Логин: 3–24 символа, латиница, цифры, _ . -', 'err');
      if (f.password !== f.password2) return toast('Пароли не совпадают', 'err');
      busy(e.submitter, () => store.setupLeader({ login: f.login, password: f.password, nick: f.nick.trim() }, SEED_ROLES))
        .then(() => toast('Клан создан. Добро пожаловать, глава!', 'ok')).catch(() => {});
    };
    return;
  }
  app.innerHTML = `
    <form class="center-card" id="login">
      <div class="sigil">☠</div>
      <h1>NIGHTMARE</h1>
      <p class="muted">Вход для участников клана. Логин и пароль выдаёт глава.</p>
      <label>Логин<input name="login" required autocomplete="username"></label>
      <label>Пароль<input name="password" type="password" required autocomplete="current-password"></label>
      <button class="btn primary wide">Войти</button>
    </form>`;
  $('#login').onsubmit = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    busy(e.submitter, () => store.signIn(f.login, f.password)).catch(() => {});
  };
}

// ───────────────────────── brief ─────────────────────────
function viewBrief(app) {
  const m = me(); const r = roleOf(m);
  const tactics = [...S.tactics].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const myTasks = tactics.map((t) => {
    const steps = (t.phases || []).map((p, i) => ({ i, name: p.name, act: (p.actions || {})[m.id] })).filter((s) => s.act);
    return { t, steps };
  });
  const pending = tactics.filter((t) => !ackedCurrent(t, m.id)).length + S.situations.filter((x) => !ackedCurrent(x, m.id)).length;

  app.innerHTML = `
    <section class="hero">
      <div>
        <div class="eyebrow">Брифинг бойца</div>
        <h1>${esc(m.nick)}</h1>
        <div class="row gap">${roleBadge(r)}<span class="access ${ACCESS[m.access].cls}">${ACCESS[m.access].name}</span></div>
      </div>
      <div class="stat-row">
        <div class="stat"><b>${S.members.length}</b><span>в составе</span></div>
        <div class="stat"><b>${S.tactics.length}</b><span>тактик</span></div>
        <div class="stat ${pending ? 'hot' : ''}"><b>${pending}</b><span>не изучено</span></div>
      </div>
    </section>

    <div class="grid two">
      <section class="card role-card" style="--c:${esc(r?.color || '#555')}">
        <h2>Моя роль</h2>
        ${r ? `
          <div class="role-title">${esc(r.icon || '')} ${esc(r.name)}</div>
          <p>${nl(r.description)}</p>
          ${(r.duties || []).length ? `<h3>Обязанности</h3><ul class="duties">${r.duties.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}
        ` : '<p class="muted">Тебе ещё не назначили роль. Глава назначает роли в разделе «Состав».</p>'}
      </section>

      <section class="card">
        <h2>Кто за что отвечает</h2>
        <ul class="mini-roster">
          ${sortedMembers().map((x) => `<li class="${x.id === m.id ? 'me' : ''}"><span class="dot" style="--c:${esc(roleOf(x)?.color || '#555')}"></span><b>${esc(x.nick)}</b>${roleBadge(roleOf(x))}</li>`).join('')}
        </ul>
      </section>
    </div>

    <section class="card">
      <h2>Мои задачи в тактиках</h2>
      ${myTasks.length ? myTasks.map(({ t, steps }) => `
        <div class="task-block">
          <div class="task-head">
            <a href="#/tactic/${t.id}" class="task-title">${esc(t.title)}</a>
            ${ackedCurrent(t, m.id) ? '<span class="ack ok">✓ изучено</span>' : `<button class="btn sm primary" data-ack="${t.id}">Я понял</button>`}
          </div>
          ${steps.length ? `<ol class="steps">${steps.map((s) => `<li><span class="phase-tag">Фаза ${s.i + 1}${s.name ? ' · ' + esc(s.name) : ''}</span>${nl(s.act)}</li>`).join('')}</ol>`
            : '<p class="muted sm">Для тебя в этой тактике нет отдельных действий — изучи общую схему.</p>'}
        </div>`).join('') : `<p class="muted">Тактик пока нет.${isEditor() ? ' <a href="#/tactics">Создай первую</a>.' : ''}</p>`}
    </section>

    <section class="card">
      <div class="row between"><h2>Моё поведение в ситуациях</h2><a href="#/situations" class="sm">Все ситуации →</a></div>
      ${mySituationsHtml(m)}
    </section>`;
  bindAck(app);
}

function bindAck(root) {
  $$('[data-ack]', root).forEach((b) => b.onclick = () => {
    const col = b.dataset.col || 'tactics';
    const t = S[col].find((x) => x.id === b.dataset.ack);
    busy(b, () => store.patch(col, t.id, { [`acks.${S.user.uid}`]: t.version || 1 }))
      .then(() => toast(col === 'tactics' ? 'Отмечено: тактика изучена' : 'Отмечено: ситуация изучена', 'ok')).catch(() => {});
  });
}

// ───────────────────────── roster ─────────────────────────
function viewRoster(app) {
  const lead = isLeader();
  app.innerHTML = `
    <div class="page-head">
      <div><h1>Состав клана</h1><p class="muted">${S.members.length} игроков. Каждый видит роли всех, чтобы понимать, кто что делает.</p></div>
      ${lead ? '<button class="btn primary" id="add-member">+ Выдать доступ</button>' : ''}
    </div>
    <div class="member-grid">
      ${sortedMembers().map((m) => {
        const r = roleOf(m);
        return `<article class="card member" style="--c:${esc(r?.color || '#444')}">
          <div class="member-top">
            <div class="avatar">${esc(m.nick.slice(0, 2).toUpperCase())}</div>
            <div><div class="member-nick">${esc(m.nick)}</div><div class="muted sm">@${esc(m.login)}</div></div>
            <span class="access ${ACCESS[m.access].cls}">${ACCESS[m.access].name}</span>
          </div>
          ${lead ? `
            <label class="sm">Роль<select data-role="${m.id}">
              <option value="">— без роли —</option>
              ${S.roles.map((x) => `<option value="${x.id}" ${x.id === m.roleId ? 'selected' : ''}>${esc(x.icon || '')} ${esc(x.name)}</option>`).join('')}
            </select></label>
            ${m.access !== 'leader' ? `
            <div class="row gap">
              <select data-access="${m.id}" class="grow">
                <option value="member" ${m.access === 'member' ? 'selected' : ''}>Боец — только смотрит</option>
                <option value="officer" ${m.access === 'officer' ? 'selected' : ''}>Офицер — редактирует тактики</option>
              </select>
              <button class="btn ghost sm danger" data-del="${m.id}" title="Забрать доступ">✕</button>
            </div>` : ''}
          ` : `<div>${roleBadge(r)}</div>`}
          ${r && (r.duties || []).length ? `<ul class="duties sm">${r.duties.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}
        </article>`;
      }).join('')}
    </div>`;

  if (!lead) return;
  $('#add-member').onclick = addMemberModal;
  $$('[data-role]', app).forEach((s) => s.onchange = () =>
    store.patch('members', s.dataset.role, { roleId: s.value }).then(() => toast('Роль назначена', 'ok')).catch((e) => toast(e.message, 'err')));
  $$('[data-access]', app).forEach((s) => s.onchange = () =>
    store.patch('members', s.dataset.access, { access: s.value }).then(() => toast('Права обновлены', 'ok')).catch((e) => toast(e.message, 'err')));
  $$('[data-del]', app).forEach((b) => b.onclick = () => {
    const m = member(b.dataset.del);
    if (!confirm(`Забрать доступ у ${m.nick}? Он больше не сможет войти на сайт.`)) return;
    busy(b, () => store.remove('members', m.id)).then(() => toast('Доступ закрыт')).catch(() => {});
  });
}

function addMemberModal() {
  modal(`
    <form id="mf">
      <h2>Выдать доступ игроку</h2>
      <p class="muted sm">Создай логин и пароль и передай их игроку лично (в игре или в мессенджере).</p>
      <label>Ник в игре<input name="nick" required maxlength="24"></label>
      <label>Логин<input name="login" required placeholder="латиница, цифры, _ . -" autocomplete="off"></label>
      <label>Пароль<div class="row gap"><input name="password" required minlength="6" class="grow" value="${genPassword()}" autocomplete="off"><button type="button" class="btn ghost sm" id="gen">⟳</button></div></label>
      <label>Права<select name="access"><option value="member">Боец — только смотрит</option><option value="officer">Офицер — редактирует тактики, роли и карты</option></select></label>
      <label>Роль<select name="roleId"><option value="">— без роли —</option>${S.roles.map((r) => `<option value="${r.id}">${esc(r.icon || '')} ${esc(r.name)}</option>`).join('')}</select></label>
      <div class="modal-actions"><button type="button" class="btn ghost" data-close>Отмена</button><button class="btn primary">Создать</button></div>
    </form>`, (w, close) => {
    $('#gen', w).onclick = () => { $('[name=password]', w).value = genPassword(); };
    $('#mf', w).onsubmit = (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      f.login = f.login.trim().toLowerCase(); f.nick = f.nick.trim();
      if (!LOGIN_RE.test(f.login)) return toast('Логин: 3–24 символа, латиница, цифры, _ . -', 'err');
      busy(e.submitter, () => store.createMember(f)).then(() => {
        close();
        const text = `NIGHTMARE — доступ к сайту клана\nСайт: ${location.origin + location.pathname}\nЛогин: ${f.login}\nПароль: ${f.password}`;
        modal(`
          <h2>Доступ создан ✓</h2>
          <p>Передай эти данные игроку <b>${esc(f.nick)}</b>. Пароль больше нигде не показывается.</p>
          <pre class="creds">${esc(text)}</pre>
          <div class="modal-actions"><button class="btn ghost" id="copy">Скопировать</button><button class="btn primary" data-close>Готово</button></div>`,
        (w2) => { $('#copy', w2).onclick = () => navigator.clipboard.writeText(text).then(() => toast('Скопировано', 'ok')); });
      }).catch(() => {});
    };
  });
}

// ───────────────────────── roles ─────────────────────────
function viewRoles(app) {
  const ed = isEditor();
  app.innerHTML = `
    <div class="page-head">
      <div><h1>Роли</h1><p class="muted">Что делает каждая роль. Назначать роли игрокам можно в разделе «Состав».</p></div>
      ${ed ? '<button class="btn primary" id="add-role">+ Новая роль</button>' : ''}
    </div>
    <div class="grid three">
      ${S.roles.map((r) => {
        const holders = S.members.filter((m) => m.roleId === r.id);
        return `<article class="card role-card" style="--c:${esc(r.color)}">
          <div class="role-title">${esc(r.icon || '')} ${esc(r.name)}</div>
          <p>${nl(r.description)}</p>
          ${(r.duties || []).length ? `<ul class="duties">${r.duties.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}
          <div class="holders">${holders.length ? holders.map((m) => `<span class="chip">${esc(m.nick)}</span>`).join('') : '<span class="muted sm">никто не назначен</span>'}</div>
          ${ed ? `<div class="row gap end"><button class="btn ghost sm" data-edit="${r.id}">Изменить</button><button class="btn ghost sm danger" data-del="${r.id}">Удалить</button></div>` : ''}
        </article>`;
      }).join('') || '<p class="muted">Ролей пока нет.</p>'}
    </div>`;
  if (!ed) return;
  $('#add-role').onclick = () => roleModal();
  $$('[data-edit]', app).forEach((b) => b.onclick = () => roleModal(S.roles.find((r) => r.id === b.dataset.edit)));
  $$('[data-del]', app).forEach((b) => b.onclick = () => {
    const r = S.roles.find((x) => x.id === b.dataset.del);
    if (!confirm(`Удалить роль «${r.name}»?`)) return;
    busy(b, () => store.remove('roles', r.id)).catch(() => {});
  });
}

function roleModal(r) {
  const colors = ['#c4142b', '#ff7a1a', '#ffd23f', '#7dff6a', '#3fd0ff', '#4d6bff', '#9b5cff', '#ff4fd8', '#e8e6ea'];
  r = r || { name: '', color: colors[Math.floor(Math.random() * colors.length)], icon: '', description: '', duties: [] };
  modal(`
    <form id="rf">
      <h2>${r.id ? 'Изменить роль' : 'Новая роль'}</h2>
      <div class="row gap">
        <label class="w-icon">Значок<input name="icon" maxlength="2" value="${esc(r.icon)}" placeholder="⚔"></label>
        <label class="grow">Название<input name="name" required maxlength="30" value="${esc(r.name)}"></label>
      </div>
      <label>Цвет<div class="swatches">${colors.map((c) => `<label class="swatch" style="--c:${c}"><input type="radio" name="color" value="${c}" ${c === r.color ? 'checked' : ''}></label>`).join('')}<input type="color" name="custom" value="${esc(r.color)}"></div></label>
      <label>Описание<textarea name="description" rows="3">${esc(r.description)}</textarea></label>
      <label>Обязанности <span class="muted sm">(каждая с новой строки)</span><textarea name="duties" rows="5">${esc((r.duties || []).join('\n'))}</textarea></label>
      <div class="modal-actions"><button type="button" class="btn ghost" data-close>Отмена</button><button class="btn primary">Сохранить</button></div>
    </form>`, (w, close) => {
    const custom = $('[name=custom]', w);
    custom.oninput = () => $$('[name=color]', w).forEach((x) => { x.checked = false; });
    $('#rf', w).onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const data = {
        name: f.get('name').trim(), icon: f.get('icon').trim(),
        color: f.get('color') || custom.value,
        description: f.get('description').trim(),
        duties: f.get('duties').split('\n').map((s) => s.trim()).filter(Boolean),
      };
      busy(e.submitter, () => store.save('roles', r.id, data)).then(close).catch(() => {});
    };
  });
}

// ───────────────────────── tactics list ─────────────────────────
function viewTactics(app) {
  const ed = isEditor();
  const list = [...S.tactics].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  app.innerHTML = `
    <div class="page-head">
      <div><h1>Тактики</h1><p class="muted">Каждая тактика разбита на фазы: где стоит каждый игрок и что он делает.</p></div>
      ${ed ? '<a class="btn primary" href="#/tactic/new/edit">+ Новая тактика</a>' : ''}
    </div>
    <div class="grid three">
      ${list.map((t) => {
        const acked = S.members.filter((m) => ackedCurrent(t, m.id)).length;
        const img = mapImage(t.mapId);
        return `<a class="card tactic-card" href="#/tactic/${t.id}">
          <div class="thumb" ${img ? `style="background-image:url('${img}')"` : ''}></div>
          <div class="tactic-title">${esc(t.title)}</div>
          <p class="muted sm clamp">${esc(t.description)}</p>
          <div class="row gap sm">
            <span class="chip">${(t.phases || []).length} фаз</span>
            <span class="chip ${acked === S.members.length ? 'ok' : ''}">изучили ${acked}/${S.members.length}</span>
            ${ackedCurrent(t, S.user.uid) ? '' : '<span class="chip hot">новое для тебя</span>'}
          </div>
        </a>`;
      }).join('') || '<p class="muted">Тактик пока нет.</p>'}
    </div>`;
}

// ───────────────────────── tactic view ─────────────────────────
function viewTactic(app, r) {
  if (r.sub === 'edit') return viewTacticEdit(app, r);
  const t = S.tactics.find((x) => x.id === r.id);
  if (!t) { app.innerHTML = '<div class="card"><p>Тактика не найдена.</p><a href="#/tactics">← К списку</a></div>'; return; }
  const phases = t.phases || [];
  if (S.viewPhase >= phases.length + 1) S.viewPhase = 0;
  const matrix = S.viewPhase === phases.length && phases.length > 0;
  const ph = phases[S.viewPhase];
  const myId = S.user.uid;
  const acks = S.members.map((m) => ({ m, ok: ackedCurrent(t, m.id) }));

  app.innerHTML = `
    <div class="page-head">
      <div>
        <a href="#/tactics" class="muted sm">← Тактики</a>
        <h1>${esc(t.title)}</h1>
        ${t.description ? `<p>${nl(t.description)}</p>` : ''}
        <p class="muted sm">Обновлено ${fmtDate(t.updatedAt)}${member(t.updatedBy) ? ' · ' + esc(member(t.updatedBy).nick) : ''} · версия ${t.version || 1}</p>
      </div>
      <div class="row gap">
        ${ackedCurrent(t, myId) ? '<span class="ack ok">✓ ты изучил</span>' : `<button class="btn primary" data-ack="${t.id}">Я понял тактику</button>`}
        ${isEditor() ? `<a class="btn ghost" href="#/tactic/${t.id}/edit">Редактировать</a>` : ''}
      </div>
    </div>

    ${phases.length ? `
    <div class="tabs">
      ${phases.map((p, i) => `<button class="tab ${i === S.viewPhase ? 'active' : ''}" data-ph="${i}"><b>${i + 1}</b> ${esc(p.name || 'Фаза')}</button>`).join('')}
      <button class="tab ${matrix ? 'active' : ''}" data-ph="${phases.length}">▦ Кто что делает</button>
    </div>` : '<p class="muted">В тактике пока нет фаз.</p>'}

    ${matrix ? matrixHtml(t) : ph ? `
    <div class="tactic-layout">
      <div class="board-wrap"><svg id="board"></svg></div>
      <aside class="card side">
        ${ph.notes ? `<h3>Суть фазы</h3><p>${nl(ph.notes)}</p>` : ''}
        ${ph.trigger ? `<div class="trigger"><b>Сигнал перехода дальше:</b> ${nl(ph.trigger)}</div>` : ''}
        <h3>Действия игроков</h3>
        <ul class="actions">
          ${sortedMembers().filter((m) => (ph.actions || {})[m.id] || (ph.positions || {})[m.id]).map((m) => `
            <li class="${m.id === myId ? 'me' : ''}" style="--c:${esc(roleOf(m)?.color || '#555')}">
              <div class="who"><span class="dot"></span><b>${esc(m.nick)}</b> <span class="muted sm">${esc(roleOf(m)?.name || '')}</span></div>
              <div>${nl((ph.actions || {})[m.id] || '—')}</div>
            </li>`).join('') || '<li class="muted">Действия не расписаны</li>'}
        </ul>
      </aside>
    </div>` : ''}

    <section class="card">
      <h3>Кто изучил текущую версию</h3>
      <div class="holders">${acks.map(({ m, ok }) => `<span class="chip ${ok ? 'ok' : 'hot'}">${ok ? '✓' : '…'} ${esc(m.nick)}</span>`).join('')}</div>
    </section>`;

  $$('[data-ph]', app).forEach((b) => b.onclick = () => { S.viewPhase = +b.dataset.ph; render(); });
  bindAck(app);
  if (ph && !matrix) {
    const board = new Board($('#board'), { readOnly: true, tokenInfo });
    board.setData(clone(ph), mapImage(t.mapId));
  }
}

function matrixHtml(t) {
  const phases = t.phases || [];
  const rows = sortedMembers().filter((m) => phases.some((p) => (p.actions || {})[m.id]));
  if (!rows.length) return '<p class="muted card">Действия игроков ещё не расписаны.</p>';
  return `<div class="card matrix-wrap"><table class="matrix">
    <thead><tr><th>Игрок</th>${phases.map((p, i) => `<th>${i + 1}. ${esc(p.name || 'Фаза')}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((m) => `<tr class="${m.id === S.user.uid ? 'me' : ''}">
      <th style="--c:${esc(roleOf(m)?.color || '#555')}"><span class="dot"></span>${esc(m.nick)}<div class="muted sm">${esc(roleOf(m)?.name || '')}</div></th>
      ${phases.map((p) => `<td>${nl((p.actions || {})[m.id] || '')}</td>`).join('')}
    </tr>`).join('')}</tbody></table></div>`;
}

// ───────────────────────── tactic editor ─────────────────────────
const newPhase = (prev) => ({
  name: '', notes: '', trigger: '', actions: {},
  positions: prev ? clone(prev.positions || {}) : {}, arrows: [], labels: [],
});

function viewTacticEdit(app, r) {
  if (!isEditor()) { location.hash = '#/tactics'; return; }
  if (!S.draft || S.draftKind !== 'tactic' || (S.draft.id || 'new') !== r.id) {
    S.draftKind = 'tactic';
    const t = r.id === 'new' ? null : S.tactics.find((x) => x.id === r.id);
    if (r.id !== 'new' && !t) { app.innerHTML = '<div class="card">Тактика не найдена.</div>'; return; }
    S.draft = t ? clone(t) : { title: '', description: '', mapId: '', phases: [newPhase()], acks: {}, version: 0 };
    S.phaseIdx = 0; S.remoteChanged = false;
  }
  const d = S.draft;
  if (S.phaseIdx >= d.phases.length) S.phaseIdx = d.phases.length - 1;
  const ph = d.phases[S.phaseIdx];

  app.innerHTML = `
    <div class="page-head">
      <div><a href="#/${d.id ? 'tactic/' + d.id : 'tactics'}" class="muted sm">← Отмена</a><h1>${d.id ? 'Редактирование' : 'Новая тактика'}</h1></div>
      <div class="row gap">
        ${d.id ? '<button class="btn ghost danger" id="del-t">Удалить</button>' : ''}
        <button class="btn primary" id="save-t">Сохранить</button>
      </div>
    </div>
    <div class="warn" id="remote-warn" ${S.remoteChanged ? '' : 'hidden'}>⚠ Кто-то другой только что сохранил эту тактику. Если сохранишь сейчас — его изменения перезапишутся.</div>

    <section class="card form-grid">
      <label>Название<input id="t-title" maxlength="60" value="${esc(d.title)}" placeholder="Например: Захват центра"></label>
      <label>Карта<select id="t-map"><option value="">— сетка без карты —</option>${S.maps.map((m) => `<option value="${m.id}" ${m.id === d.mapId ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label>
      <label class="span2">Описание / цель<textarea id="t-desc" rows="2">${esc(d.description)}</textarea></label>
    </section>

    <div class="tabs">
      ${d.phases.map((p, i) => `<button class="tab ${i === S.phaseIdx ? 'active' : ''}" data-ph="${i}"><b>${i + 1}</b> ${esc(p.name || 'Фаза')}</button>`).join('')}
      <button class="tab add" id="add-ph">+ Фаза</button>
    </div>

    <div class="tactic-layout">
      <div>
        <div class="toolbar">
          <div class="seg" id="modes">
            <button data-mode="move" class="active" title="Перетаскивать фишки и подписи">✋ Двигать</button>
            <button data-mode="arrow" title="Тяни мышкой/пальцем">➚ Стрелка</button>
            <button data-mode="label" title="Нажми на схему">T Подпись</button>
            <button data-mode="erase" title="Нажми на объект">⌫ Стереть</button>
          </div>
          <div class="colors" id="colors">${ARROW_COLORS.map((c, i) => `<button style="--c:${c}" data-color="${c}" class="${i === 0 ? 'active' : ''}"></button>`).join('')}
            <label class="dash-toggle"><input type="checkbox" id="dash"> пунктир</label></div>
        </div>
        <div class="board-wrap"><svg id="board"></svg></div>
        <div class="token-bar">
          <span class="muted sm">Добавить на схему:</span>
          <span id="token-chips"></span>
          <button class="btn ghost sm" id="all-tokens">Всех</button>
        </div>
        <div class="row gap phase-ops">
          <button class="btn ghost sm" id="ph-left" ${S.phaseIdx === 0 ? 'disabled' : ''}>← Сдвинуть</button>
          <button class="btn ghost sm" id="ph-right" ${S.phaseIdx === d.phases.length - 1 ? 'disabled' : ''}>Сдвинуть →</button>
          <button class="btn ghost sm" id="ph-dup">Дублировать фазу</button>
          <button class="btn ghost sm danger" id="ph-del" ${d.phases.length < 2 ? 'disabled' : ''}>Удалить фазу</button>
        </div>
      </div>
      <aside class="card side">
        <label>Название фазы<input id="p-name" maxlength="30" value="${esc(ph.name)}" placeholder="Например: Выход на позиции"></label>
        <label>Суть фазы<textarea id="p-notes" rows="3">${esc(ph.notes)}</textarea></label>
        <label>Сигнал перехода к следующей фазе<input id="p-trigger" value="${esc(ph.trigger)}" placeholder="Например: Командир пишет «ГО»"></label>
        <h3>Что делает каждый</h3>
        <div class="action-edit">
          ${sortedMembers().map((m) => `
            <label style="--c:${esc(roleOf(m)?.color || '#555')}"><span class="who"><span class="dot"></span>${esc(m.nick)} <span class="muted sm">${esc(roleOf(m)?.name || '')}</span></span>
            <textarea rows="2" data-act="${m.id}" placeholder="—">${esc((ph.actions || {})[m.id] || '')}</textarea></label>`).join('')}
        </div>
      </aside>
    </div>`;

  // поля тактики
  $('#t-title').oninput = (e) => { d.title = e.target.value; };
  $('#t-desc').oninput = (e) => { d.description = e.target.value; };
  $('#t-map').onchange = (e) => { d.mapId = e.target.value; board.setData(ph, mapImage(d.mapId)); };
  // поля фазы
  $('#p-name').oninput = (e) => { ph.name = e.target.value; $(`[data-ph="${S.phaseIdx}"]`).innerHTML = `<b>${S.phaseIdx + 1}</b> ${esc(ph.name || 'Фаза')}`; };
  $('#p-notes').oninput = (e) => { ph.notes = e.target.value; };
  $('#p-trigger').oninput = (e) => { ph.trigger = e.target.value; };
  $$('[data-act]', app).forEach((ta) => ta.oninput = () => {
    ph.actions = ph.actions || {};
    if (ta.value.trim()) ph.actions[ta.dataset.act] = ta.value; else delete ph.actions[ta.dataset.act];
  });

  // схема
  const board = new Board($('#board'), { tokenInfo, onChange: renderChips });
  board.setData(ph, mapImage(d.mapId));
  function renderChips() {
    const off = sortedMembers().filter((m) => !ph.positions[m.id]);
    $('#token-chips').innerHTML = off.map((m) => `<button class="chip btn-chip" data-tok="${m.id}" style="--c:${esc(roleOf(m)?.color || '#555')}"><span class="dot"></span>${esc(m.nick)}</button>`).join('') || '<span class="muted sm">все на схеме</span>';
    $$('[data-tok]').forEach((b) => b.onclick = () => board.addToken(b.dataset.tok));
  }
  renderChips();
  $('#all-tokens').onclick = () => { sortedMembers().forEach((m) => { if (!ph.positions[m.id]) board.addToken(m.id); }); };
  $$('#modes button').forEach((b) => b.onclick = () => {
    $$('#modes button').forEach((x) => x.classList.toggle('active', x === b)); board.setMode(b.dataset.mode);
  });
  $$('#colors [data-color]').forEach((b) => b.onclick = () => {
    $$('#colors [data-color]').forEach((x) => x.classList.toggle('active', x === b)); board.color = b.dataset.color;
    $$('#modes button').forEach((x) => x.classList.toggle('active', x.dataset.mode === 'arrow')); board.setMode('arrow');
  });
  $('#dash').onchange = (e) => { board.dash = e.target.checked; };

  // фазы
  $$('[data-ph]', app).forEach((b) => b.onclick = () => { S.phaseIdx = +b.dataset.ph; render(); });
  $('#add-ph').onclick = () => { d.phases.push(newPhase(d.phases[d.phases.length - 1])); S.phaseIdx = d.phases.length - 1; render(); };
  $('#ph-dup').onclick = () => { d.phases.splice(S.phaseIdx + 1, 0, { ...clone(ph), name: (ph.name || 'Фаза') + ' (копия)' }); S.phaseIdx++; render(); };
  $('#ph-del').onclick = () => { if (confirm('Удалить эту фазу?')) { d.phases.splice(S.phaseIdx, 1); render(); } };
  const move = (dir) => { const i = S.phaseIdx, j = i + dir; [d.phases[i], d.phases[j]] = [d.phases[j], d.phases[i]]; S.phaseIdx = j; render(); };
  $('#ph-left').onclick = () => move(-1);
  $('#ph-right').onclick = () => move(1);

  // сохранение
  $('#save-t').onclick = (e) => {
    if (!d.title.trim()) return toast('Дай тактике название', 'err');
    const data = { ...d, title: d.title.trim(), version: (d.version || 0) + 1, updatedAt: Date.now(), updatedBy: S.user.uid };
    delete data.id;
    data.acks = { ...(d.acks || {}), [S.user.uid]: data.version };
    busy(e.currentTarget, () => store.save('tactics', d.id, data)).then((id) => {
      toast('Тактика сохранена. Всем игрокам нужно изучить новую версию.', 'ok');
      S.draft = null; S.viewPhase = S.phaseIdx; location.hash = `#/tactic/${id}`;
    }).catch(() => {});
  };
  const del = $('#del-t');
  if (del) del.onclick = () => {
    if (!confirm(`Удалить тактику «${d.title}» насовсем?`)) return;
    busy(del, () => store.remove('tactics', d.id)).then(() => { S.draft = null; location.hash = '#/tactics'; }).catch(() => {});
  };
}

// ───────────────────────── situations ─────────────────────────
// Ситуация = «что происходит» + сигнал + общее правило + поведение КАЖДОЙ роли.
const SEED_SITUATIONS = [
  { title: 'Команда внутри, ты снаружи', category: 'Вход и выход', description: 'Основная группа уже зашла, а ты отстал и остался снаружи.', signal: 'Пишешь «СНАРУЖИ» и где ты', common: 'Отставшего не ждём, если это ломает план. Снаружи не геройствуем.',
    byRoleName: { 'Командир': 'Решает: ждать или продолжать. Назначает, кто прикрывает вход.', 'Разведчик': 'Остаётся снаружи глазами команды: докладывает, кто подходит.', 'Штурмовик': 'Не лезет в одиночку. Заходит только вместе с поддержкой или по команде.', 'Поддержка': 'Заходит к команде безопасным путём, на ходу сообщает своё состояние.', 'Защитник': 'Занимает позицию у входа и прикрывает его снаружи.' } },
  { title: 'Ты внутри, команда снаружи', category: 'Вход и выход', description: 'Ты зашёл первым или один, остальные ещё снаружи.', signal: '«ВНУТРИ, ОДИН»', common: 'Не уходить вглубь, держаться у входа до подхода команды.',
    byRoleName: { 'Командир': 'Держит точку у входа и ведёт команду через чат.', 'Разведчик': 'Тихо осматривается, ничего не трогает, докладывает обстановку.', 'Штурмовик': 'Занимает укрытие и не начинает бой первым.', 'Поддержка': 'Ищет безопасное место и ждёт команду.', 'Защитник': 'Держит вход изнутри, чтобы команда зашла без проблем.' } },
  { title: 'Команда разделилась', category: 'Вход и выход', description: 'Группа распалась на части и не видит друг друга.', signal: '«РАЗДЕЛИЛИСЬ» и где ты', common: 'Каждая часть сообщает своё место. Встречаемся в точке сбора.',
    byRoleName: { 'Командир': 'Называет точку сбора и решает, какая группа к какой идёт.', 'Разведчик': 'Ищет короткий безопасный путь между группами.', 'Штурмовик': 'Остаётся с ближайшей группой и защищает её.', 'Поддержка': 'Идёт к группе, где больше раненых или меньше людей.', 'Защитник': 'Держит точку сбора, пока все не соберутся.' } },
  { title: 'Потеряли командира', category: 'Потери', description: 'Командир выбыл или пропал со связи.', signal: '«КОМ ВЫБЫЛ»', common: 'Командование сразу переходит к заранее назначенному заместителю.',
    byRoleName: { 'Командир': 'Ещё до боя назначает заместителя.', 'Разведчик': 'Сразу докладывает обстановку новому командиру.', 'Штурмовик': 'Прекращает атаку, если нового приказа нет.', 'Поддержка': 'Помогает командиру вернуться, если это безопасно.', 'Защитник': 'Прикрывает отход к точке сбора.' } },
  { title: 'Их больше, чем нас', category: 'Бой', description: 'Противников заметно больше, прямой бой проигрышный.', signal: '«ИХ БОЛЬШЕ»', common: 'Не размениваемся поодиночке, держимся вместе.',
    byRoleName: { 'Командир': 'Решает: отступаем или держим узкое место.', 'Разведчик': 'Считает противников и следит, откуда они идут.', 'Штурмовик': 'Не идёт в лоб, бьёт из укрытия.', 'Поддержка': 'Держится рядом с основной группой.', 'Защитник': 'Держит узкий проход.' } },
  { title: 'Атака с тыла', category: 'Бой', description: 'Противник неожиданно зашёл сзади.', signal: '«ТЫЛ!»', common: 'Кто увидел угрозу первым, сразу пишет сигнал.',
    byRoleName: { 'Командир': 'Разворачивает на угрозу тех, кто к ней ближе.', 'Разведчик': 'Указывает, откуда атака и сколько противников.', 'Штурмовик': 'Разворачивается на угрозу по команде.', 'Поддержка': 'Уходит из-под удара за спины штурмовиков.', 'Защитник': 'Первым принимает удар с тыла.' } },
  { title: 'Отступление', category: 'Отступление', description: 'План сорвался, нужно уходить.', signal: '«ОТХОД» и точка сбора', common: 'Отходим к точке сбора. Никто не остаётся один.',
    byRoleName: { 'Командир': 'Объявляет отход и точку сбора.', 'Разведчик': 'Первым проверяет путь отхода.', 'Штурмовик': 'Прикрывает отход и уходит последним.', 'Поддержка': 'Уходит одним из первых и помогает отставшим.', 'Защитник': 'Держит проход, пока все не уйдут.' } },
];

const sitCoverage = (x) => S.roles.filter((r) => ((x.byRole || {})[r.id] || '').trim()).length;
const sitCategories = () => [...new Set(S.situations.map((x) => (x.category || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
const sortSituations = (list) => [...list].sort((a, b) => (a.category || '').localeCompare(b.category || '') || a.title.localeCompare(b.title));

function mySituationsHtml(m) {
  const r = roleOf(m);
  if (!S.situations.length) return `<p class="muted">Ситуаций пока нет.${isEditor() ? ' <a href="#/situations">Добавь первые</a>.' : ''}</p>`;
  const list = sortSituations(S.situations).filter((x) => (r && (x.byRole || {})[r.id]) || x.common);
  if (!list.length) return '<p class="muted">Для твоей роли поведение ещё не расписано.</p>';
  return `<div class="sit-brief-grid">${list.map((x) => `
    <div class="sit-brief">
      <div class="task-head">
        <a href="#/situation/${x.id}" class="task-title">${esc(x.title)}</a>
        ${ackedCurrent(x, m.id) ? '<span class="ack ok">✓</span>' : `<button class="btn sm primary" data-col="situations" data-ack="${x.id}">Я понял</button>`}
      </div>
      ${x.signal ? `<div class="signal sm">📣 ${esc(x.signal)}</div>` : ''}
      ${r && (x.byRole || {})[r.id] ? `<div class="my-move" style="--c:${esc(r.color)}"><b>Ты (${esc(r.name)}):</b> ${nl(x.byRole[r.id])}</div>` : ''}
      ${x.common ? `<div class="muted sm"><b>Всем:</b> ${nl(x.common)}</div>` : ''}
    </div>`).join('')}</div>`;
}

function sitFiltered() {
  const f = S.sitFilter;
  const q = f.q.trim().toLowerCase();
  return sortSituations(S.situations).filter((x) => {
    if (f.cat && (x.category || '') !== f.cat) return false;
    if (f.gaps && sitCoverage(x) === S.roles.length && x.common) return false;
    if (!q) return true;
    const hay = [x.title, x.category, x.description, x.signal, x.common, ...Object.values(x.byRole || {})].join(' ').toLowerCase();
    return hay.includes(q);
  });
}

function viewSituations(app) {
  const ed = isEditor();
  const f = S.sitFilter;
  const total = S.situations.length * S.roles.length;
  const filled = S.situations.reduce((n, x) => n + sitCoverage(x), 0);
  const pct = total ? Math.round(filled / total * 100) : 0;
  const cats = sitCategories();
  if (f.cat && !cats.includes(f.cat)) f.cat = '';

  app.innerHTML = `
    <div class="page-head">
      <div><h1>Ситуации</h1><p class="muted">Что делает каждая роль в конкретной ситуации. Чем больше ситуаций разобрано заранее, тем меньше хаоса в бою.</p></div>
      ${ed ? `<div class="row gap">
        ${S.situations.length < 3 ? '<button class="btn ghost" id="seed-sit">Добавить типовые</button>' : ''}
        <a class="btn primary" href="#/situation/new/edit">+ Новая ситуация</a></div>` : ''}
    </div>

    ${S.situations.length ? `
    <section class="card coverage">
      <div class="row between"><b>Проработано ${filled} из ${total} «ситуация × роль»</b><span class="muted sm">${S.situations.length} ситуаций · ${S.roles.length} ролей</span></div>
      <div class="bar"><span style="width:${pct}%"></span></div>
    </section>

    <div class="sit-toolbar">
      <input id="sit-q" type="search" placeholder="Поиск: «снаружи», «отход», «тыл»…" value="${esc(f.q)}">
      <select id="sit-cat"><option value="">Все категории</option>${cats.map((c) => `<option ${c === f.cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      <label class="check"><input type="checkbox" id="sit-gaps" ${f.gaps ? 'checked' : ''}> только с пробелами</label>
      <div class="seg" id="sit-mode">
        <button data-m="cards" class="${f.mode === 'cards' ? 'active' : ''}">Карточки</button>
        <button data-m="table" class="${f.mode === 'table' ? 'active' : ''}">Таблица «роль × ситуация»</button>
      </div>
    </div>
    <div id="sit-list"></div>` : `<div class="card empty-state">
      <h2>Ситуаций пока нет</h2>
      <p class="muted">Ситуация — это то, что может случиться в бою: «команда внутри, а ты снаружи», «потеряли командира», «атака с тыла». Для каждой расписывается, что делает каждая роль.</p>
      ${ed ? '<p class="muted">Начни с типовых ситуаций и переделай их под ROB RUN или создай свою.</p>' : ''}
    </div>`}`;

  const seed = $('#seed-sit');
  if (seed) seed.onclick = () => busy(seed, seedSituations).then(() => toast('Типовые ситуации добавлены — переделай их под себя', 'ok')).catch(() => {});
  if (!S.situations.length) return;

  $('#sit-q').oninput = (e) => { f.q = e.target.value; renderSitList(); };
  $('#sit-cat').onchange = (e) => { f.cat = e.target.value; renderSitList(); };
  $('#sit-gaps').onchange = (e) => { f.gaps = e.target.checked; renderSitList(); };
  $$('#sit-mode button').forEach((b) => b.onclick = () => {
    f.mode = b.dataset.m;
    $$('#sit-mode button').forEach((x) => x.classList.toggle('active', x === b));
    renderSitList();
  });
  renderSitList();
}

function renderSitList() {
  const box = $('#sit-list');
  if (!box) return;
  const list = sitFiltered();
  const ed = isEditor();
  const myRole = roleOf(me());
  if (!list.length) { box.innerHTML = '<p class="muted">Ничего не найдено.</p>'; return; }

  if (S.sitFilter.mode === 'table') {
    box.innerHTML = `<div class="card matrix-wrap"><table class="matrix sit-matrix">
      <thead><tr><th>Ситуация</th><th>Всем</th>${S.roles.map((r) => `<th style="--c:${esc(r.color)}" class="${r.id === myRole?.id ? 'my-col' : ''}">${roleBadge(r)}</th>`).join('')}</tr></thead>
      <tbody>${list.map((x) => `<tr>
        <th><a href="#/situation/${x.id}">${esc(x.title)}</a>${x.category ? `<div class="muted sm">${esc(x.category)}</div>` : ''}</th>
        ${cellHtml(x, 'common', x.common, ed)}
        ${S.roles.map((r) => cellHtml(x, r.id, (x.byRole || {})[r.id], ed, r.id === myRole?.id)).join('')}
      </tr>`).join('')}</tbody></table></div>
      ${ed ? '<p class="muted sm">Нажми на клетку, чтобы расписать поведение роли в этой ситуации.</p>' : ''}`;
    if (ed) $$('[data-cell]', box).forEach((td) => td.onclick = () => {
      const [id, key] = td.dataset.cell.split('|');
      cellModal(S.situations.find((x) => x.id === id), key);
    });
    return;
  }

  box.innerHTML = `<div class="grid three">${list.map((x) => {
    const cov = sitCoverage(x);
    return `<a class="card sit-card" href="#/situation/${x.id}">
      ${x.category ? `<span class="eyebrow-sm">${esc(x.category)}</span>` : ''}
      <div class="tactic-title">${esc(x.title)}</div>
      <p class="muted sm clamp">${esc(x.description)}</p>
      ${myRole && (x.byRole || {})[myRole.id] ? `<div class="my-move sm" style="--c:${esc(myRole.color)}"><b>Ты:</b> ${esc(x.byRole[myRole.id])}</div>` : ''}
      <div class="row gap sm">
        <span class="chip ${cov === S.roles.length ? 'ok' : 'hot'}">ролей ${cov}/${S.roles.length}</span>
        ${ackedCurrent(x, S.user.uid) ? '' : '<span class="chip hot">новое для тебя</span>'}
      </div>
    </a>`;
  }).join('')}</div>`;
}

function cellHtml(x, key, text, ed, mine) {
  const cls = ['cell', text ? '' : 'empty', ed ? 'editable' : '', mine ? 'my-col' : ''].join(' ');
  return `<td class="${cls}" ${ed ? `data-cell="${x.id}|${key}" title="Изменить"` : ''}>${text ? nl(text) : (ed ? '<span class="add">+ расписать</span>' : '<span class="muted">—</span>')}</td>`;
}

function cellModal(x, key) {
  const r = key === 'common' ? null : S.roles.find((y) => y.id === key);
  const cur = key === 'common' ? (x.common || '') : ((x.byRole || {})[key] || '');
  modal(`
    <form id="cf">
      <div class="eyebrow-sm">${esc(x.category || 'Ситуация')}</div>
      <h2>${esc(x.title)}</h2>
      ${x.description ? `<p class="muted sm">${nl(x.description)}</p>` : ''}
      <label>${r ? `Что делает ${roleBadge(r)}` : 'Общее правило для всех'}<textarea name="t" rows="5" placeholder="Конкретные действия: куда идти, что писать в чат, чего не делать">${esc(cur)}</textarea></label>
      <div class="modal-actions"><button type="button" class="btn ghost" data-close>Отмена</button><button class="btn primary">Сохранить</button></div>
    </form>`, (w, close) => {
    $('#cf', w).onsubmit = (e) => {
      e.preventDefault();
      const t = new FormData(e.target).get('t').trim();
      const v = (x.version || 1) + 1;
      busy(e.submitter, () => store.patch('situations', x.id, {
        [key === 'common' ? 'common' : `byRole.${key}`]: t,
        version: v, updatedAt: Date.now(), updatedBy: S.user.uid, [`acks.${S.user.uid}`]: v,
      })).then(close).catch(() => {});
    };
  });
}

async function seedSituations() {
  const byName = Object.fromEntries(S.roles.map((r) => [r.name.trim().toLowerCase(), r.id]));
  const have = new Set(S.situations.map((x) => x.title.trim().toLowerCase()));
  for (const s of SEED_SITUATIONS) {
    if (have.has(s.title.toLowerCase())) continue;
    const byRole = {};
    for (const [name, text] of Object.entries(s.byRoleName)) {
      const id = byName[name.toLowerCase()];
      if (id) byRole[id] = text;
    }
    await store.save('situations', null, {
      title: s.title, category: s.category, description: s.description, signal: s.signal, common: s.common,
      byRole, version: 1, acks: { [S.user.uid]: 1 }, updatedAt: Date.now(), updatedBy: S.user.uid,
    });
  }
}

function viewSituation(app, r) {
  if (r.sub === 'edit') return viewSituationEdit(app, r);
  const x = S.situations.find((s) => s.id === r.id);
  if (!x) { app.innerHTML = '<div class="card"><p>Ситуация не найдена.</p><a href="#/situations">← К списку</a></div>'; return; }
  const ed = isEditor();
  const myRole = roleOf(me());
  const list = sitFiltered();
  const idx = list.findIndex((s) => s.id === x.id);
  const prev = idx > 0 ? list[idx - 1] : null;
  const next = idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null;
  const roles = [...S.roles].sort((a, b) => (b.id === myRole?.id) - (a.id === myRole?.id));
  const noRole = S.members.filter((m) => !roleOf(m));

  app.innerHTML = `
    <div class="page-head">
      <div>
        <a href="#/situations" class="muted sm">← Ситуации</a>
        ${x.category ? `<div class="eyebrow-sm">${esc(x.category)}</div>` : ''}
        <h1>${esc(x.title)}</h1>
        <p class="muted sm">Обновлено ${fmtDate(x.updatedAt)}${member(x.updatedBy) ? ' · ' + esc(member(x.updatedBy).nick) : ''} · версия ${x.version || 1}</p>
      </div>
      <div class="row gap">
        ${ackedCurrent(x, S.user.uid) ? '<span class="ack ok">✓ ты изучил</span>' : `<button class="btn primary" data-col="situations" data-ack="${x.id}">Я понял</button>`}
        ${ed ? `<a class="btn ghost" href="#/situation/${x.id}/edit">Редактировать</a>` : ''}
      </div>
    </div>

    <div class="grid two">
      <section class="card">
        <h3>Когда это происходит</h3>
        <p>${x.description ? nl(x.description) : '<span class="muted">—</span>'}</p>
        ${x.signal ? `<div class="trigger"><b>Сигнал в чат:</b> ${nl(x.signal)}</div>` : ''}
      </section>
      <section class="card common-card ${ed ? 'editable' : ''}" ${ed ? 'data-edit-cell="common"' : ''}>
        <h3>Всем</h3>
        <p>${x.common ? nl(x.common) : '<span class="muted">Общее правило не задано</span>'}</p>
      </section>
    </div>

    <h2>Поведение каждой роли</h2>
    <div class="role-grid">
      ${roles.map((ro) => {
        const text = (x.byRole || {})[ro.id];
        const holders = S.members.filter((m) => m.roleId === ro.id);
        return `<article class="card role-move ${ro.id === myRole?.id ? 'me' : ''} ${text ? '' : 'empty'} ${ed ? 'editable' : ''}" style="--c:${esc(ro.color)}" ${ed ? `data-edit-cell="${ro.id}"` : ''}>
          <div class="row between">${roleBadge(ro)}${ro.id === myRole?.id ? '<span class="chip hot">твоя роль</span>' : ''}</div>
          <div class="holders">${holders.map((m) => `<span class="chip">${esc(m.nick)}</span>`).join('') || '<span class="muted sm">никто не назначен</span>'}</div>
          <p>${text ? nl(text) : `<span class="muted">Не расписано${ed ? ' — нажми, чтобы добавить' : ''}</span>`}</p>
        </article>`;
      }).join('')}
    </div>
    ${noRole.length ? `<p class="muted sm">Без роли: ${noRole.map((m) => esc(m.nick)).join(', ')}. Им достаточно правила «Всем».</p>` : ''}

    <div class="row between sit-nav">
      ${prev ? `<a class="btn ghost" href="#/situation/${prev.id}">← ${esc(prev.title)}</a>` : '<span></span>'}
      ${next ? `<a class="btn ghost" href="#/situation/${next.id}">${esc(next.title)} →</a>` : '<span></span>'}
    </div>

    <section class="card">
      <h3>Кто изучил текущую версию</h3>
      <div class="holders">${S.members.map((m) => { const ok = ackedCurrent(x, m.id); return `<span class="chip ${ok ? 'ok' : 'hot'}">${ok ? '✓' : '…'} ${esc(m.nick)}</span>`; }).join('')}</div>
    </section>`;

  bindAck(app);
  if (ed) $$('[data-edit-cell]', app).forEach((c) => c.onclick = () => cellModal(x, c.dataset.editCell));
}

function viewSituationEdit(app, r) {
  if (!isEditor()) { location.hash = '#/situations'; return; }
  if (!S.draft || S.draftKind !== 'situation' || (S.draft.id || 'new') !== r.id) {
    S.draftKind = 'situation';
    const x = r.id === 'new' ? null : S.situations.find((s) => s.id === r.id);
    if (r.id !== 'new' && !x) { app.innerHTML = '<div class="card">Ситуация не найдена.</div>'; return; }
    S.draft = x ? clone(x) : { title: '', category: S.lastSitCat || S.sitFilter.cat || '', description: '', signal: '', common: '', byRole: {}, acks: {}, version: 0 };
    S.remoteChanged = false;
  }
  const d = S.draft;
  d.byRole = d.byRole || {};

  app.innerHTML = `
    <div class="page-head">
      <div><a href="#/${d.id ? 'situation/' + d.id : 'situations'}" class="muted sm">← Отмена</a><h1>${d.id ? 'Редактирование ситуации' : 'Новая ситуация'}</h1></div>
      <div class="row gap">
        ${d.id ? '<button class="btn ghost danger" id="del-s">Удалить</button>' : ''}
        ${d.id ? '' : '<button class="btn ghost" id="save-next">Сохранить и ещё одну</button>'}
        <button class="btn primary" id="save-s">Сохранить</button>
      </div>
    </div>
    <div class="warn" id="remote-warn" ${S.remoteChanged ? '' : 'hidden'}>⚠ Кто-то другой только что сохранил эту ситуацию. Если сохранишь сейчас, его изменения перезапишутся.</div>

    <section class="card form-grid">
      <label>Ситуация (коротко)<input data-f="title" maxlength="80" value="${esc(d.title)}" placeholder="Например: Команда внутри, ты снаружи"></label>
      <label>Категория<input data-f="category" maxlength="30" list="cats" value="${esc(d.category)}" placeholder="Вход и выход, Бой, Потери…"><datalist id="cats">${sitCategories().map((c) => `<option value="${esc(c)}">`).join('')}</datalist></label>
      <label class="span2">Когда это происходит<textarea data-f="description" rows="2" placeholder="Подробнее: как понять, что это именно эта ситуация">${esc(d.description)}</textarea></label>
      <label>Сигнал в чат<input data-f="signal" maxlength="80" value="${esc(d.signal)}" placeholder="Например: пишем «СНАРУЖИ»"></label>
      <label>Всем (общее правило)<textarea data-f="common" rows="2">${esc(d.common)}</textarea></label>
    </section>

    <h2>Что делает каждая роль</h2>
    <div class="role-grid">
      ${S.roles.map((ro) => `<label class="card role-move edit" style="--c:${esc(ro.color)}">
        ${roleBadge(ro)}
        <textarea data-role-f="${ro.id}" rows="4" placeholder="Куда идти, что писать, чего НЕ делать">${esc(d.byRole[ro.id] || '')}</textarea>
      </label>`).join('') || '<p class="muted">Сначала создай роли в разделе «Роли».</p>'}
    </div>`;

  $$('[data-f]', app).forEach((i) => i.oninput = () => { d[i.dataset.f] = i.value; });
  $$('[data-role-f]', app).forEach((t) => t.oninput = () => {
    if (t.value.trim()) d.byRole[t.dataset.roleF] = t.value; else delete d.byRole[t.dataset.roleF];
  });

  const save = (btn, again) => {
    if (!d.title.trim()) return toast('Опиши ситуацию в заголовке', 'err');
    const v = (d.version || 0) + 1;
    const data = { ...d, title: d.title.trim(), category: (d.category || '').trim(), version: v, updatedAt: Date.now(), updatedBy: S.user.uid };
    delete data.id;
    data.acks = { ...(d.acks || {}), [S.user.uid]: v };
    busy(btn, () => store.save('situations', d.id, data)).then((id) => {
      toast('Ситуация сохранена', 'ok');
      const cat = data.category;
      S.draft = null;
      if (again) {
        S.lastSitCat = cat;
        viewSituationEdit(app, { id: 'new' });
        window.scrollTo({ top: 0 });
        $('[data-f=title]').focus();
      } else location.hash = `#/situation/${id}`;
    }).catch(() => {});
  };
  $('#save-s').onclick = (e) => save(e.currentTarget, false);
  const sn = $('#save-next'); if (sn) sn.onclick = (e) => save(e.currentTarget, true);
  const del = $('#del-s');
  if (del) del.onclick = () => {
    if (!confirm(`Удалить ситуацию «${d.title}»?`)) return;
    busy(del, () => store.remove('situations', d.id)).then(() => { S.draft = null; location.hash = '#/situations'; }).catch(() => {});
  };
}

// ───────────────────────── maps ─────────────────────────
function viewMaps(app) {
  const ed = isEditor();
  app.innerHTML = `
    <div class="page-head">
      <div><h1>Карты</h1><p class="muted">Скриншоты карт или локаций из игры — на них рисуются тактики.</p></div>
      ${ed ? '<button class="btn primary" id="add-map">+ Загрузить карту</button>' : ''}
    </div>
    <div class="grid three">
      ${S.maps.map((m) => `<article class="card map-card">
        <div class="thumb big" style="background-image:url('${m.image}')"></div>
        <div class="row between"><b>${esc(m.name)}</b>${ed ? `<button class="btn ghost sm danger" data-del="${m.id}">Удалить</button>` : ''}</div>
        <span class="muted sm">в тактиках: ${S.tactics.filter((t) => t.mapId === m.id).length}</span>
      </article>`).join('') || '<p class="muted">Карт пока нет. Без карты тактики рисуются на сетке.</p>'}
    </div>`;
  if (!ed) return;
  $('#add-map').onclick = () => modal(`
    <form id="mapf">
      <h2>Новая карта</h2>
      <label>Название<input name="name" required maxlength="40"></label>
      <label>Картинка (скриншот)<input name="file" type="file" accept="image/*" required></label>
      <p class="muted sm">Картинка автоматически сжимается. Лучше всего подходит широкий скриншот (16:10 или 16:9).</p>
      <div class="modal-actions"><button type="button" class="btn ghost" data-close>Отмена</button><button class="btn primary">Загрузить</button></div>
    </form>`, (w, close) => {
    $('#mapf', w).onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      busy(e.submitter, async () => {
        const image = await imageToDataUrl(f.get('file'));
        await store.save('maps', null, { name: f.get('name').trim(), image, createdAt: Date.now() });
      }).then(close).catch(() => {});
    };
  });
  $$('[data-del]', app).forEach((b) => b.onclick = () => {
    if (!confirm('Удалить карту? Тактики на ней останутся, но без фона.')) return;
    busy(b, () => store.remove('maps', b.dataset.del)).catch(() => {});
  });
}

// ───────────────────────── profile ─────────────────────────
function viewProfile(app) {
  const m = me();
  app.innerHTML = `
    <div class="page-head"><div><h1>Профиль</h1><p class="muted">@${esc(m.login)} · ${ACCESS[m.access].name}</p></div></div>
    <div class="grid two">
      <form class="card" id="nickf">
        <h2>Ник</h2>
        <label>Ник в игре<input name="nick" required maxlength="24" value="${esc(m.nick)}"></label>
        <button class="btn primary">Сохранить</button>
      </form>
      <form class="card" id="pwf">
        <h2>Сменить пароль</h2>
        <label>Текущий пароль<input name="old" type="password" required autocomplete="current-password"></label>
        <label>Новый пароль<input name="pw" type="password" required minlength="6" autocomplete="new-password"></label>
        <label>Повтори новый<input name="pw2" type="password" required minlength="6" autocomplete="new-password"></label>
        <button class="btn primary">Сменить пароль</button>
      </form>
    </div>`;
  $('#nickf').onsubmit = (e) => {
    e.preventDefault();
    busy(e.submitter, () => store.patch('members', m.id, { nick: new FormData(e.target).get('nick').trim() })).then(() => toast('Ник обновлён', 'ok')).catch(() => {});
  };
  $('#pwf').onsubmit = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if (f.pw !== f.pw2) return toast('Пароли не совпадают', 'err');
    busy(e.submitter, () => store.changeMyPassword(f.old, f.pw)).then(() => { e.target.reset(); toast('Пароль изменён', 'ok'); }).catch(() => {});
  };
}

boot();
