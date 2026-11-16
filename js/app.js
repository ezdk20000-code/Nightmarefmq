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
let store;
const S = {
  user: null, setupDone: false, ready: false,
  members: [], roles: [], tactics: [], maps: [],
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
  if (!(r.page === 'tactic' && r.sub === 'edit')) S.draft = null;
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
      for (const name of ['members', 'roles', 'tactics', 'maps']) {
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
  if (S.loaded.size < 4) return;
  if (!me()) {
    toast('Твой доступ отозван главой клана', 'err');
    store.signOut();
    return;
  }
  const r = route();
  if (r.page === 'tactic' && r.sub === 'edit' && S.draft) {
    if (name === 'tactics' && S.draft.id) {
      const t = S.tactics.find((x) => x.id === S.draft.id);
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
  if (S.loaded.size < 4 || !me()) { app.innerHTML = '<div class="loader">NIGHTMARE</div>'; return; }
  renderNav();
  const r = route();
  const views = { brief: viewBrief, roster: viewRoster, roles: viewRoles, tactics: viewTactics, tactic: viewTactic, maps: viewMaps, profile: viewProfile };
  (views[r.page] || viewBrief)(app, r);
  window.scrollTo({ top: window.scrollY });
}

function renderNav() {
  const r = route().page;
  const m = me();
  const links = [['brief', 'Брифинг'], ['tactics', 'Тактики'], ['roster', 'Состав'], ['roles', 'Роли'], ['maps', 'Карты']];
  $('#nav').innerHTML = `
    ${links.map(([k, t]) => `<a href="#/${k}" class="${r === k || (k === 'tactics' && r === 'tactic') ? 'active' : ''}">${t}</a>`).join('')}
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
  const pending = tactics.filter((t) => !ackedCurrent(t, m.id)).length;

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
    </section>`;
  bindAck(app);
}

function bindAck(root) {
  $$('[data-ack]', root).forEach((b) => b.onclick = () => {
    const t = S.tactics.find((x) => x.id === b.dataset.ack);
    busy(b, () => store.patch('tactics', t.id, { [`acks.${S.user.uid}`]: t.version || 1 }))
      .then(() => toast('Отмечено: тактика изучена', 'ok')).catch(() => {});
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
  if (!S.draft || (S.draft.id || 'new') !== r.id) {
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
