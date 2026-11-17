import { createStore } from './store.js';
import { Board, ARROW_COLORS } from './board.js';

// ───────────────────────── helpers ─────────────────────────
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nl = (s) => esc(s).replace(/\n/g, '<br>');
const clone = (o) => JSON.parse(JSON.stringify(o));
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

// Ситуация = что случилось + что делает каждая роль.
const SEED_SITUATIONS = [
  { title: 'Команда внутри, ты снаружи', common: 'Отставшего не ждём, если это ломает план.',
    byRoleName: { 'Командир': 'Решает: ждать или продолжать.', 'Разведчик': 'Остаётся снаружи и докладывает, кто подходит.', 'Штурмовик': 'Не лезет один, заходит по команде.', 'Поддержка': 'Заходит к команде безопасным путём.', 'Защитник': 'Прикрывает вход снаружи.' } },
  { title: 'Ты внутри, команда снаружи', common: 'Не уходить вглубь, ждать команду у входа.',
    byRoleName: { 'Командир': 'Держит точку у входа и ведёт команду через чат.', 'Разведчик': 'Тихо осматривается, докладывает обстановку.', 'Штурмовик': 'Занимает укрытие, бой первым не начинает.', 'Поддержка': 'Ищет безопасное место и ждёт команду.', 'Защитник': 'Держит вход изнутри.' } },
  { title: 'Команда разделилась', common: 'Каждая часть пишет, где она. Встречаемся в точке сбора.',
    byRoleName: { 'Командир': 'Называет точку сбора.', 'Разведчик': 'Ищет безопасный путь между группами.', 'Штурмовик': 'Остаётся с ближайшей группой.', 'Поддержка': 'Идёт к группе, где меньше людей.', 'Защитник': 'Держит точку сбора.' } },
  { title: 'Потеряли командира', common: 'Командование переходит к заместителю.',
    byRoleName: { 'Командир': 'До боя назначает заместителя.', 'Разведчик': 'Докладывает обстановку новому командиру.', 'Штурмовик': 'Останавливает атаку без приказа.', 'Поддержка': 'Помогает командиру, если безопасно.', 'Защитник': 'Прикрывает отход к точке сбора.' } },
  { title: 'Атака с тыла', common: 'Кто увидел первым — сразу пишет «ТЫЛ!».',
    byRoleName: { 'Командир': 'Разворачивает ближайших на угрозу.', 'Разведчик': 'Говорит, откуда и сколько.', 'Штурмовик': 'Разворачивается по команде.', 'Поддержка': 'Уходит за спины штурмовиков.', 'Защитник': 'Первым встречает удар.' } },
  { title: 'Отступление', common: 'Отходим к точке сбора, никто не остаётся один.',
    byRoleName: { 'Командир': 'Объявляет отход и точку сбора.', 'Разведчик': 'Проверяет путь отхода.', 'Штурмовик': 'Уходит последним, прикрывает.', 'Поддержка': 'Помогает отставшим.', 'Защитник': 'Держит проход, пока все не уйдут.' } },
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

const autogrow = (t) => { t.style.height = 'auto'; t.style.height = t.scrollHeight + 2 + 'px'; };

// ───────────────────────── state ─────────────────────────
const COLLECTIONS = ['members', 'roles', 'tactics', 'maps', 'situations'];
let store;
const S = {
  user: null, setupDone: false, ready: false,
  members: [], roles: [], tactics: [], maps: [], situations: [],
  loaded: new Set(), unsubs: [],
  draft: null, phaseIdx: 0, viewPhase: 0, dirty: false,
};

const me = () => S.members.find((m) => m.id === S.user?.uid);
const isLeader = () => me()?.access === 'leader';
const isEditor = () => ['leader', 'officer'].includes(me()?.access);
const roleOf = (m) => S.roles.find((r) => r.id === m?.roleId);
const role = (id) => S.roles.find((r) => r.id === id);
const member = (id) => S.members.find((m) => m.id === id);
const myRole = () => roleOf(me());
const holders = (r) => S.members.filter((m) => m.roleId === r.id);
const sortedMembers = () => [...S.members].sort((a, b) => {
  const o = { leader: 0, officer: 1, member: 2 };
  return (o[a.access] - o[b.access]) || a.nick.localeCompare(b.nick);
});
const sortedTactics = () => [...S.tactics].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0) || a.title.localeCompare(b.title));
const sortedSituations = () => [...S.situations].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0) || a.title.localeCompare(b.title));
const sitText = (x, id) => (id === 'common' ? x.common : (x.byRole || {})[id]) || '';
const mapImage = (id) => S.maps.find((m) => m.id === id)?.image || null;
// Фишки на схеме — это роли.
const tokenInfo = (rid) => {
  const r = role(rid);
  if (!r) return null;
  return { label: r.name, color: r.color, me: rid === myRole()?.id };
};

function roleBadge(r) {
  if (!r) return '<span class="role-badge none">без роли</span>';
  return `<span class="role-badge" style="--c:${esc(r.color)}">${esc(r.icon || '')} ${esc(r.name)}</span>`;
}

// ───────────────────────── routing ─────────────────────────
function route() {
  const h = location.hash.replace(/^#\/?/, '') || 'me';
  const [page, id, sub, extra] = h.split('/');
  return { page, id, sub, extra };
}
window.addEventListener('hashchange', () => {
  if (S.dirty && !confirm('Есть несохранённые изменения. Уйти без сохранения?')) {
    history.replaceState(null, '', S.lastHash || '#/');
    return;
  }
  S.dirty = false;
  if (!location.hash.endsWith('/edit')) S.draft = null;
  S.lastHash = location.hash;
  render();
});
window.addEventListener('beforeunload', (e) => { if (S.dirty) e.preventDefault(); });

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
  S.lastHash = location.hash;
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

function onData() {
  if (S.loaded.size < COLLECTIONS.length) return;
  if (!me()) {
    toast('Твой доступ отозван главой клана', 'err');
    store.signOut();
    return;
  }
  if (S.dirty) { renderNav(); return; } // не перерисовываем форму, чтобы не потерять ввод
  render();
}

// ───────────────────────── render root ─────────────────────────
function render() {
  const app = $('#app');
  app.oninput = null; // «не сохранено» ставят только формы редактирования
  if (!S.ready) { app.innerHTML = '<div class="loader">NIGHTMARE</div>'; return; }
  if (!S.user) { $('#nav').innerHTML = ''; return renderAuth(app); }
  if (S.loaded.size < COLLECTIONS.length || !me()) { app.innerHTML = '<div class="loader">NIGHTMARE</div>'; return; }
  renderNav();
  const r = route();
  const views = { me: viewMe, roles: viewRoles, role: viewRole, hq: viewHq, profile: viewProfile };
  (views[r.page] || viewMe)(app, r);
}

function renderNav() {
  const r = route();
  const m = me();
  const mine = myRole();
  const links = [['me', 'Моя роль'], ['roles', 'Все роли']];
  if (isEditor()) links.push(['hq', 'Штаб']);
  const active = (k) => r.page === k || (k === 'roles' && r.page === 'role' && r.id !== mine?.id) || (k === 'me' && r.page === 'role' && r.id === mine?.id);
  $('#nav').innerHTML = `
    ${links.map(([k, t]) => `<a href="#/${k}" class="${active(k) ? 'active' : ''}">${t}</a>`).join('')}
    <a href="#/profile" class="nav-me ${r.page === 'profile' ? 'active' : ''}"><span class="dot" style="--c:${esc(mine?.color || '#777')}"></span>${esc(m?.nick)}</a>
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

// ───────────────────────── моя роль ─────────────────────────
function viewMe(app) {
  const r = myRole();
  if (r) return viewRole(app, { page: 'role', id: r.id });
  const m = me();
  app.innerHTML = `
    <div class="card empty-state">
      <div class="sigil">☠</div>
      <h2>${esc(m.nick)}, у тебя пока нет роли</h2>
      <p class="muted">Роль назначает глава клана. Как только она появится, здесь будет всё, что тебе нужно: обязанности, действия в тактиках и поведение в разных ситуациях.</p>
      <p><a class="btn ghost" href="#/roles">Посмотреть все роли</a>${isLeader() ? ' <a class="btn primary" href="#/hq/members">Назначить роли в составе</a>' : ''}</p>
    </div>`;
}

// ───────────────────────── страница роли ─────────────────────────
function viewRole(app, rt) {
  if (rt.sub === 'edit') return viewRoleEdit(app, rt);
  const r = role(rt.id);
  if (!r) { app.innerHTML = '<div class="card"><p>Роль не найдена.</p><a href="#/roles">← Все роли</a></div>'; return; }
  const mine = r.id === myRole()?.id;
  const ed = isEditor();
  const ppl = holders(r);
  const tactics = sortedTactics();
  const sits = sortedSituations().filter((x) => sitText(x, r.id) || x.common);

  app.innerHTML = `
    <section class="role-hero" style="--c:${esc(r.color)}">
      <div class="role-hero-main">
        <div class="eyebrow">${mine ? 'Моя роль' : 'Роль'}</div>
        <h1><span class="role-icon">${esc(r.icon || '')}</span>${esc(r.name)}</h1>
        ${r.description ? `<p class="lead">${nl(r.description)}</p>` : ''}
        <div class="holders">${ppl.length ? ppl.map((m) => `<span class="chip ${m.id === S.user.uid ? 'me' : ''}">${esc(m.nick)}</span>`).join('') : '<span class="muted sm">никто не назначен</span>'}</div>
      </div>
      <div class="row gap">
        ${ed ? `<a class="btn primary" href="#/role/${r.id}/edit">Редактировать</a>` : ''}
        ${mine ? '' : '<a class="btn ghost" href="#/roles">Все роли</a>'}
      </div>
    </section>

    <div class="role-sections">
      <section class="card" style="--c:${esc(r.color)}">
        <h2>Обязанности</h2>
        ${(r.duties || []).length ? `<ul class="duties big">${r.duties.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : '<p class="muted">Пока не расписаны.</p>'}
      </section>

      <section class="card" style="--c:${esc(r.color)}">
        <h2>В тактиках</h2>
        ${tactics.length ? tactics.map((t) => `
          <div class="rt-tactic">
            <div class="rt-head">
              <div><b>${esc(t.title)}</b>${t.description ? `<div class="muted sm">${nl(t.description)}</div>` : ''}</div>
              ${ed ? `<a class="muted sm" href="#/hq/tactic/${t.id}">схема и все роли →</a>` : ''}
            </div>
            <ol class="phases">
              ${(t.phases || []).map((p, i) => {
                const act = (p.actions || {})[r.id];
                const hasBoard = (p.positions || {})[r.id] || (p.arrows || []).length;
                return `<li class="${act ? '' : 'empty'}">
                  <div class="ph-title"><span class="phase-tag">${i + 1}</span><b>${esc(p.name || 'Фаза ' + (i + 1))}</b>
                    ${hasBoard ? `<button class="link sm" data-board="${t.id}|${i}">схема</button>` : ''}
                  </div>
                  <div class="ph-act">${act ? nl(act) : '<span class="muted">действие не задано</span>'}</div>
                  ${p.trigger ? `<div class="ph-trigger">→ дальше по сигналу: <b>${esc(p.trigger)}</b></div>` : ''}
                </li>`;
              }).join('') || '<li class="muted">Фаз нет.</li>'}
            </ol>
          </div>`).join('') : `<p class="muted">Тактик пока нет.${ed ? ' <a href="#/hq/tactics">Создать в штабе</a>.' : ''}</p>`}
      </section>

      <section class="card" style="--c:${esc(r.color)}">
        <h2>Если что-то пошло не так</h2>
        ${sits.length ? `<div class="sit-rows">${sits.map((x) => {
          const own = sitText(x, r.id);
          return `<div class="sit-row" style="--c:${esc(r.color)}">
            <div class="sit-who">${esc(x.title)}</div>
            <div>${own ? nl(own) : `<span class="muted">всем: </span>${nl(x.common)}`}${own && x.common ? `<div class="muted sm">всем: ${nl(x.common)}</div>` : ''}</div>
          </div>`;
        }).join('')}</div>` : `<p class="muted">Ситуаций пока нет.${ed ? ' <a href="#/hq/situations">Добавить в штабе</a>.' : ''}</p>`}
      </section>
    </div>`;

  $$('[data-board]', app).forEach((b) => b.onclick = () => {
    const [tid, i] = b.dataset.board.split('|');
    const t = S.tactics.find((x) => x.id === tid);
    const ph = t.phases[+i];
    modal(`<div class="eyebrow-sm">${esc(t.title)} · фаза ${+i + 1}</div><h2>${esc(ph.name || 'Фаза')}</h2>
      <div class="board-wrap"><svg id="mboard"></svg></div>
      <div class="modal-actions"><button class="btn primary" data-close>Закрыть</button></div>`, (w) => {
      w.querySelector('.modal').classList.add('wide');
      const board = new Board($('#mboard', w), { readOnly: true, tokenInfo });
      board.setData(clone(ph), mapImage(t.mapId));
    });
  });
}

// Редактирование роли: описание + поведение во всех тактиках и ситуациях в одном месте.
function viewRoleEdit(app, rt) {
  if (!isEditor()) { location.hash = `#/role/${rt.id}`; return; }
  const r = role(rt.id);
  if (!r) { app.innerHTML = '<div class="card">Роль не найдена.</div>'; return; }
  const tactics = sortedTactics();
  const sits = sortedSituations();
  const colors = ['#c4142b', '#ff7a1a', '#ffd23f', '#7dff6a', '#3fd0ff', '#4d6bff', '#9b5cff', '#ff4fd8', '#e8e6ea'];

  app.innerHTML = `
    <div class="page-head">
      <div><a href="#/role/${r.id}" class="muted sm">← Отмена</a><h1>${esc(r.name)}: редактирование</h1></div>
      <div class="row gap">
        <button class="btn ghost danger" id="del-r">Удалить роль</button>
        <button class="btn primary" id="save-r">Сохранить всё</button>
      </div>
    </div>

    <div class="role-sections">
      <section class="card form-grid">
        <div class="row gap span2">
          <label class="w-icon">Значок<input id="r-icon" maxlength="2" value="${esc(r.icon || '')}" placeholder="⚔"></label>
          <label class="grow">Название<input id="r-name" maxlength="30" value="${esc(r.name)}"></label>
        </div>
        <label class="span2">Цвет<div class="swatches">${colors.map((c) => `<label class="swatch" style="--c:${c}"><input type="radio" name="color" value="${c}" ${c === r.color ? 'checked' : ''}></label>`).join('')}<input type="color" id="r-custom" value="${esc(r.color)}"></div></label>
        <label class="span2">Описание<textarea id="r-desc" rows="2">${esc(r.description || '')}</textarea></label>
        <label class="span2">Обязанности <span class="muted sm">(каждая с новой строки)</span><textarea id="r-duties" rows="4">${esc((r.duties || []).join('\n'))}</textarea></label>
      </section>

      <section class="card">
        <h2>В тактиках</h2>
        <p class="muted sm">Что делает ${esc(r.name)} в каждой фазе. Сами тактики, фазы и схемы создаются в <a href="#/hq/tactics">штабе</a>.</p>
        ${tactics.map((t) => `
          <div class="rt-tactic">
            <div class="rt-head"><b>${esc(t.title)}</b><a class="muted sm" href="#/hq/tactic/${t.id}/edit">изменить тактику →</a></div>
            ${(t.phases || []).map((p, i) => `
              <label class="ph-edit"><span class="ph-title"><span class="phase-tag">${i + 1}</span><b>${esc(p.name || 'Фаза ' + (i + 1))}</b>${p.trigger ? `<span class="muted sm"> · дальше по сигналу «${esc(p.trigger)}»</span>` : ''}</span>
              <textarea rows="1" data-act="${t.id}|${i}" placeholder="Что делает ${esc(r.name)} в этой фазе">${esc((p.actions || {})[r.id] || '')}</textarea></label>`).join('')}
          </div>`).join('') || '<p class="muted">Тактик пока нет.</p>'}
      </section>

      <section class="card">
        <h2>Если что-то пошло не так</h2>
        <p class="muted sm">Как ведёт себя ${esc(r.name)} в каждой ситуации. Список ситуаций и общие правила — в <a href="#/hq/situations">штабе</a>.</p>
        ${sits.map((x) => `
          <label class="ph-edit"><span class="ph-title"><b>${esc(x.title)}</b>${x.common ? `<span class="muted sm"> · всем: ${esc(x.common)}</span>` : ''}</span>
          <textarea rows="1" data-sit="${x.id}" placeholder="Что делает ${esc(r.name)}">${esc(sitText(x, r.id))}</textarea></label>`).join('') || '<p class="muted">Ситуаций пока нет.</p>'}
      </section>
    </div>`;

  $$('textarea', app).forEach((t) => { autogrow(t); t.addEventListener('input', () => autogrow(t)); });
  app.oninput = () => { S.dirty = true; };
  $('#r-custom').oninput = () => $$('[name=color]', app).forEach((x) => { x.checked = false; });

  $('#save-r').onclick = (e) => busy(e.currentTarget, async () => {
    const name = $('#r-name').value.trim();
    if (!name) throw new Error('У роли должно быть название');
    const color = $('[name=color]:checked', app)?.value || $('#r-custom').value;
    await store.save('roles', r.id, {
      ...r, name, icon: $('#r-icon').value.trim(), color,
      description: $('#r-desc').value.trim(),
      duties: $('#r-duties').value.split('\n').map((s) => s.trim()).filter(Boolean),
      id: undefined,
    });
    // тактики: обновляем только те, где текст изменился
    for (const t of tactics) {
      let changed = false;
      const phases = clone(t.phases || []);
      $$(`[data-act^="${t.id}|"]`, app).forEach((ta) => {
        const i = +ta.dataset.act.split('|')[1];
        const v = ta.value.trim();
        const p = phases[i]; p.actions = p.actions || {};
        if ((p.actions[r.id] || '') !== v) { changed = true; if (v) p.actions[r.id] = v; else delete p.actions[r.id]; }
      });
      if (changed) await store.patch('tactics', t.id, { phases, updatedAt: Date.now(), updatedBy: S.user.uid });
    }
    for (const x of sits) {
      const v = $(`[data-sit="${x.id}"]`, app).value.trim();
      if (sitText(x, r.id) !== v) await store.patch('situations', x.id, { [`byRole.${r.id}`]: v, updatedAt: Date.now(), updatedBy: S.user.uid });
    }
  }).then(() => { S.dirty = false; toast('Сохранено', 'ok'); location.hash = `#/role/${r.id}`; }).catch(() => {});

  $('#del-r').onclick = (e) => {
    const n = holders(r).length;
    if (!confirm(`Удалить роль «${r.name}»?${n ? ` У ${n} игроков она пропадёт.` : ''}`)) return;
    busy(e.currentTarget, () => store.remove('roles', r.id)).then(() => { S.dirty = false; location.hash = '#/roles'; }).catch(() => {});
  };
}

// ───────────────────────── все роли ─────────────────────────
function viewRoles(app) {
  const ed = isEditor();
  const mine = myRole();
  app.innerHTML = `
    <div class="page-head">
      <div><h1>Все роли</h1><p class="muted">Открой любую роль, чтобы понять, что делает напарник.</p></div>
      ${ed ? '<button class="btn primary" id="add-role">+ Новая роль</button>' : ''}
    </div>
    <div class="grid three">
      ${S.roles.map((r) => {
        const ppl = holders(r);
        return `<a class="card role-card link-card ${r.id === mine?.id ? 'me' : ''}" style="--c:${esc(r.color)}" href="#/role/${r.id}">
          <div class="role-title">${esc(r.icon || '')} ${esc(r.name)}${r.id === mine?.id ? ' <span class="chip hot">моя</span>' : ''}</div>
          <p class="muted">${nl(r.description || '')}</p>
          <div class="holders">${ppl.length ? ppl.map((m) => `<span class="chip">${esc(m.nick)}</span>`).join('') : '<span class="muted sm">никто не назначен</span>'}</div>
        </a>`;
      }).join('') || '<p class="muted">Ролей пока нет.</p>'}
    </div>`;
  const add = $('#add-role');
  if (add) add.onclick = () => modal(`
    <form id="rf"><h2>Новая роль</h2>
      <div class="row gap"><label class="w-icon">Значок<input name="icon" maxlength="2" placeholder="⚔"></label><label class="grow">Название<input name="name" required maxlength="30"></label></div>
      <div class="modal-actions"><button type="button" class="btn ghost" data-close>Отмена</button><button class="btn primary">Создать и заполнить</button></div>
    </form>`, (w, close) => {
    $('#rf', w).onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const colors = ['#c4142b', '#ff7a1a', '#ffd23f', '#7dff6a', '#3fd0ff', '#4d6bff', '#9b5cff', '#ff4fd8'];
      const used = new Set(S.roles.map((r) => r.color));
      const color = colors.find((c) => !used.has(c)) || colors[S.roles.length % colors.length];
      busy(e.submitter, () => store.save('roles', null, { name: f.get('name').trim(), icon: f.get('icon').trim(), color, description: '', duties: [], createdAt: Date.now() }))
        .then((id) => { close(); location.hash = `#/role/${id}/edit`; }).catch(() => {});
    };
  });
}

// ───────────────────────── штаб ─────────────────────────
function viewHq(app, rt) {
  if (!isEditor()) { location.hash = '#/me'; return; }
  const tab = rt.id || 'tactics';
  if (tab === 'tactic') return viewTactic(app, { id: rt.sub, sub: rt.extra });
  const tabs = [['tactics', 'Тактики'], ['situations', 'Ситуации'], ['members', 'Состав'], ['maps', 'Карты']];
  app.innerHTML = `
    <div class="hq-tabs">${tabs.map(([k, t]) => `<a href="#/hq/${k}" class="tab ${tab === k ? 'active' : ''}">${t}</a>`).join('')}</div>
    <div id="hq"></div>`;
  ({ tactics: hqTactics, situations: hqSituations, members: hqMembers, maps: hqMaps }[tab] || hqTactics)($('#hq'), rt);
}

// --- состав
function hqMembers(app) {
  const lead = isLeader();
  app.innerHTML = `
    <div class="page-head">
      <div><h1>Состав</h1><p class="muted">${S.members.length} игроков. Роль определяет, что игрок видит на своей странице.</p></div>
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
                <option value="officer" ${m.access === 'officer' ? 'selected' : ''}>Офицер — редактирует</option>
              </select>
              <button class="btn ghost sm danger" data-del="${m.id}" title="Забрать доступ">✕</button>
            </div>` : ''}
          ` : `<div>${roleBadge(r)}</div>`}
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
      <label>Права<select name="access"><option value="member">Боец — только смотрит</option><option value="officer">Офицер — редактирует роли, тактики и ситуации</option></select></label>
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

// --- тактики
function hqTactics(app) {
  const list = sortedTactics();
  app.innerHTML = `
    <div class="page-head">
      <div><h1>Тактики</h1><p class="muted">Фазы, схема и сигналы. Что делает каждая роль, удобнее заполнять на странице роли.</p></div>
      <a class="btn primary" href="#/hq/tactic/new/edit">+ Новая тактика</a>
    </div>
    <div class="grid three">
      ${list.map((t) => {
        const img = mapImage(t.mapId);
        const filled = (t.phases || []).reduce((n, p) => n + S.roles.filter((ro) => (p.actions || {})[ro.id]).length, 0);
        const total = (t.phases || []).length * S.roles.length;
        return `<a class="card tactic-card" href="#/hq/tactic/${t.id}">
          <div class="thumb" ${img ? `style="background-image:url('${img}')"` : ''}></div>
          <div class="tactic-title">${esc(t.title)}</div>
          <p class="muted sm clamp">${esc(t.description)}</p>
          <div class="row gap sm"><span class="chip">${(t.phases || []).length} фаз</span><span class="chip ${filled === total ? 'ok' : 'hot'}">роли ${filled}/${total}</span></div>
        </a>`;
      }).join('') || '<p class="muted">Тактик пока нет.</p>'}
    </div>`;
}

function viewTactic(app, r) {
  if (r.sub === 'edit') return viewTacticEdit(app, r);
  const t = S.tactics.find((x) => x.id === r.id);
  if (!t) { app.innerHTML = '<div class="card"><p>Тактика не найдена.</p><a href="#/hq/tactics">← К списку</a></div>'; return; }
  const phases = t.phases || [];
  if (S.viewPhase >= phases.length + 1) S.viewPhase = 0;
  const matrix = S.viewPhase === phases.length && phases.length > 0;
  const ph = phases[S.viewPhase];
  const mine = myRole();

  app.innerHTML = `
    <div class="page-head">
      <div>
        <a href="#/hq/tactics" class="muted sm">← Штаб · Тактики</a>
        <h1>${esc(t.title)}</h1>
        ${t.description ? `<p>${nl(t.description)}</p>` : ''}
      </div>
      <a class="btn primary" href="#/hq/tactic/${t.id}/edit">Редактировать</a>
    </div>

    ${phases.length ? `
    <div class="tabs">
      ${phases.map((p, i) => `<button class="tab ${i === S.viewPhase ? 'active' : ''}" data-ph="${i}"><b>${i + 1}</b> ${esc(p.name || 'Фаза')}</button>`).join('')}
      <button class="tab ${matrix ? 'active' : ''}" data-ph="${phases.length}">▦ Все роли</button>
    </div>` : '<p class="muted">В тактике пока нет фаз.</p>'}

    ${matrix ? matrixHtml(t) : ph ? `
    <div class="tactic-layout">
      <div class="board-wrap"><svg id="board"></svg></div>
      <aside class="card side">
        ${ph.notes ? `<h3>Суть фазы</h3><p>${nl(ph.notes)}</p>` : ''}
        ${ph.trigger ? `<div class="trigger"><b>Сигнал перехода дальше:</b> ${nl(ph.trigger)}</div>` : ''}
        <h3>Действия ролей</h3>
        <ul class="actions">
          ${S.roles.map((ro) => `
            <li class="${ro.id === mine?.id ? 'me' : ''}" style="--c:${esc(ro.color)}">
              <div class="who"><span class="dot"></span><b>${esc(ro.name)}</b> <a class="muted sm" href="#/role/${ro.id}/edit">изменить</a></div>
              <div>${nl((ph.actions || {})[ro.id] || '—')}</div>
            </li>`).join('')}
        </ul>
      </aside>
    </div>` : ''}`;

  $$('[data-ph]', app).forEach((b) => b.onclick = () => { S.viewPhase = +b.dataset.ph; render(); });
  if (ph && !matrix) {
    const board = new Board($('#board'), { readOnly: true, tokenInfo });
    board.setData(clone(ph), mapImage(t.mapId));
  }
}

function matrixHtml(t) {
  const phases = t.phases || [];
  const mine = myRole();
  return `<div class="card matrix-wrap"><table class="matrix">
    <thead><tr><th>Роль</th>${phases.map((p, i) => `<th>${i + 1}. ${esc(p.name || 'Фаза')}</th>`).join('')}</tr></thead>
    <tbody>${S.roles.map((ro) => `<tr class="${ro.id === mine?.id ? 'me' : ''}">
      <th style="--c:${esc(ro.color)}"><span class="dot"></span><a href="#/role/${ro.id}/edit">${esc(ro.name)}</a><div class="muted sm">${holders(ro).map((m) => esc(m.nick)).join(', ')}</div></th>
      ${phases.map((p) => `<td>${nl((p.actions || {})[ro.id] || '')}</td>`).join('')}
    </tr>`).join('')}</tbody></table></div>`;
}

const newPhase = (prev) => ({
  name: '', notes: '', trigger: '', actions: {},
  positions: prev ? clone(prev.positions || {}) : {}, arrows: [], labels: [],
});

function viewTacticEdit(app, r) {
  if (!S.draft || S.draftKind !== 'tactic' || (S.draft.id || 'new') !== r.id) {
    S.draftKind = 'tactic';
    const t = r.id === 'new' ? null : S.tactics.find((x) => x.id === r.id);
    if (r.id !== 'new' && !t) { app.innerHTML = '<div class="card">Тактика не найдена.</div>'; return; }
    S.draft = t ? clone(t) : { title: '', description: '', mapId: '', phases: [newPhase()], createdAt: Date.now() };
    S.phaseIdx = 0;
  }
  const d = S.draft;
  if (S.phaseIdx >= d.phases.length) S.phaseIdx = d.phases.length - 1;
  const ph = d.phases[S.phaseIdx];
  const mark = () => { S.dirty = true; };

  app.innerHTML = `
    <div class="page-head">
      <div><a href="#/hq/${d.id ? 'tactic/' + d.id : 'tactics'}" class="muted sm">← Отмена</a><h1>${d.id ? 'Редактирование тактики' : 'Новая тактика'}</h1></div>
      <div class="row gap">
        ${d.id ? '<button class="btn ghost danger" id="del-t">Удалить</button>' : ''}
        <button class="btn primary" id="save-t">Сохранить</button>
      </div>
    </div>

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
          <span class="muted sm">Поставить на схему:</span>
          <span id="token-chips"></span>
          <button class="btn ghost sm" id="all-tokens">Все роли</button>
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
        <h3>Что делает каждая роль</h3>
        <div class="action-edit">
          ${S.roles.map((ro) => `
            <label style="--c:${esc(ro.color)}"><span class="who"><span class="dot"></span>${esc(ro.name)}</span>
            <textarea rows="2" data-act="${ro.id}" placeholder="—">${esc((ph.actions || {})[ro.id] || '')}</textarea></label>`).join('')}
        </div>
      </aside>
    </div>`;

  $('#t-title').oninput = (e) => { d.title = e.target.value; mark(); };
  $('#t-desc').oninput = (e) => { d.description = e.target.value; mark(); };
  $('#t-map').onchange = (e) => { d.mapId = e.target.value; board.setData(ph, mapImage(d.mapId)); mark(); };
  $('#p-name').oninput = (e) => { ph.name = e.target.value; $(`[data-ph="${S.phaseIdx}"]`).innerHTML = `<b>${S.phaseIdx + 1}</b> ${esc(ph.name || 'Фаза')}`; mark(); };
  $('#p-notes').oninput = (e) => { ph.notes = e.target.value; mark(); };
  $('#p-trigger').oninput = (e) => { ph.trigger = e.target.value; mark(); };
  $$('[data-act]', app).forEach((ta) => ta.oninput = () => {
    ph.actions = ph.actions || {};
    if (ta.value.trim()) ph.actions[ta.dataset.act] = ta.value; else delete ph.actions[ta.dataset.act];
    mark();
  });

  const board = new Board($('#board'), { tokenInfo, onChange: () => { renderChips(); mark(); } });
  board.setData(ph, mapImage(d.mapId));
  function renderChips() {
    const off = S.roles.filter((ro) => !ph.positions[ro.id]);
    $('#token-chips').innerHTML = off.map((ro) => `<button class="chip btn-chip" data-tok="${ro.id}" style="--c:${esc(ro.color)}"><span class="dot"></span>${esc(ro.name)}</button>`).join('') || '<span class="muted sm">все на схеме</span>';
    $$('[data-tok]').forEach((b) => b.onclick = () => board.addToken(b.dataset.tok));
  }
  renderChips();
  $('#all-tokens').onclick = () => { S.roles.forEach((ro) => { if (!ph.positions[ro.id]) board.addToken(ro.id); }); };
  $$('#modes button').forEach((b) => b.onclick = () => {
    $$('#modes button').forEach((x) => x.classList.toggle('active', x === b)); board.setMode(b.dataset.mode);
  });
  $$('#colors [data-color]').forEach((b) => b.onclick = () => {
    $$('#colors [data-color]').forEach((x) => x.classList.toggle('active', x === b)); board.color = b.dataset.color;
    $$('#modes button').forEach((x) => x.classList.toggle('active', x.dataset.mode === 'arrow')); board.setMode('arrow');
  });
  $('#dash').onchange = (e) => { board.dash = e.target.checked; };

  const rerender = () => { mark(); viewTacticEdit(app, r); };
  $$('[data-ph]', app).forEach((b) => b.onclick = () => { S.phaseIdx = +b.dataset.ph; viewTacticEdit(app, r); });
  $('#add-ph').onclick = () => { d.phases.push(newPhase(d.phases[d.phases.length - 1])); S.phaseIdx = d.phases.length - 1; rerender(); };
  $('#ph-dup').onclick = () => { d.phases.splice(S.phaseIdx + 1, 0, { ...clone(ph), name: (ph.name || 'Фаза') + ' (копия)' }); S.phaseIdx++; rerender(); };
  $('#ph-del').onclick = () => { if (confirm('Удалить эту фазу?')) { d.phases.splice(S.phaseIdx, 1); rerender(); } };
  const move = (dir) => { const i = S.phaseIdx, j = i + dir; [d.phases[i], d.phases[j]] = [d.phases[j], d.phases[i]]; S.phaseIdx = j; rerender(); };
  $('#ph-left').onclick = () => move(-1);
  $('#ph-right').onclick = () => move(1);

  $('#save-t').onclick = (e) => {
    if (!d.title.trim()) return toast('Дай тактике название', 'err');
    const data = { ...d, title: d.title.trim(), updatedAt: Date.now(), updatedBy: S.user.uid };
    delete data.id;
    busy(e.currentTarget, () => store.save('tactics', d.id, data)).then((id) => {
      toast('Тактика сохранена', 'ok');
      S.dirty = false; S.draft = null; S.viewPhase = S.phaseIdx; location.hash = `#/hq/tactic/${id}`;
    }).catch(() => {});
  };
  const del = $('#del-t');
  if (del) del.onclick = () => {
    if (!confirm(`Удалить тактику «${d.title}» насовсем?`)) return;
    busy(del, () => store.remove('tactics', d.id)).then(() => { S.dirty = false; S.draft = null; location.hash = '#/hq/tactics'; }).catch(() => {});
  };
}

// --- ситуации (список + панель, всё редактируется на месте)
const sitRows = () => [{ id: 'common', name: 'Все', icon: '👥', color: '#8f8899' }, ...S.roles];

function hqSituations(app, rt) {
  const list = sortedSituations();
  const cur = list.find((x) => x.id === rt.sub) || list[0];
  app.innerHTML = `
    <div class="page-head">
      <div><h1>Ситуации</h1><p class="muted">Что случилось и что делает каждая роль. То же самое можно заполнять на странице роли.</p></div>
      <div class="row gap">
        ${list.length < 3 ? '<button class="btn ghost" id="seed-sit">Добавить примеры</button>' : ''}
        <button class="btn primary" id="new-sit">+ Ситуация</button></div>
    </div>
    ${cur ? `<div class="sit-layout">
      <nav class="card sit-list">${list.map((x) => `<a href="#/hq/situations/${x.id}" class="${x.id === cur.id ? 'active' : ''}">${esc(x.title)}</a>`).join('')}</nav>
      <section class="card sit-panel" id="sit-panel"></section>
    </div>` : '<div class="card empty-state"><p class="muted">Пока пусто. Добавь первую ситуацию, например «Команда внутри, ты снаружи».</p></div>'}`;

  const seed = $('#seed-sit');
  if (seed) seed.onclick = () => busy(seed, seedSituations).catch(() => {});
  $('#new-sit').onclick = (e) => busy(e.currentTarget, () => store.save('situations', null, { title: 'Новая ситуация', description: '', common: '', byRole: {}, createdAt: Date.now() }))
    .then((id) => { S.focusSit = true; location.hash = `#/hq/situations/${id}`; }).catch(() => {});
  if (cur) sitEditor(cur);
}

function sitEditor(x) {
  const mine = myRole();
  const panel = $('#sit-panel');
  panel.innerHTML = `
    <input class="sit-title" id="s-title" value="${esc(x.title)}" placeholder="Что случилось">
    <textarea id="s-desc" rows="1" placeholder="Подробнее (необязательно)">${esc(x.description || '')}</textarea>
    <div class="sit-rows">${sitRows().map((ro) => `
      <label class="sit-row edit ${ro.id === mine?.id ? 'me' : ''}" style="--c:${esc(ro.color)}">
        <div class="sit-who">${esc(ro.icon || '')} ${esc(ro.name)}</div>
        <textarea rows="1" data-k="${ro.id}" placeholder="${ro.id === 'common' ? 'Правило для всех' : 'Что делает'}">${esc(sitText(x, ro.id))}</textarea>
      </label>`).join('')}</div>
    <div class="row between">
      <button class="btn ghost sm danger" id="s-del">Удалить</button>
      <span class="row gap"><span class="muted sm" id="s-status"></span><button class="btn primary" id="s-save">Сохранить</button></span>
    </div>`;

  $$('textarea', panel).forEach((t) => { autogrow(t); t.addEventListener('input', () => autogrow(t)); });
  panel.addEventListener('input', () => { S.dirty = true; $('#s-status').textContent = 'не сохранено'; });
  if (S.focusSit) { S.focusSit = false; const t = $('#s-title'); t.focus(); t.select(); }

  $('#s-save').onclick = (e) => {
    const byRole = {};
    let common = '';
    $$('[data-k]', panel).forEach((t) => {
      const v = t.value.trim();
      if (t.dataset.k === 'common') common = v; else if (v) byRole[t.dataset.k] = v;
    });
    const data = { ...x, title: $('#s-title').value.trim() || 'Без названия', description: $('#s-desc').value.trim(), common, byRole, updatedAt: Date.now(), updatedBy: S.user.uid };
    delete data.id;
    busy(e.currentTarget, () => store.save('situations', x.id, data))
      .then(() => { S.dirty = false; toast('Сохранено', 'ok'); render(); }).catch(() => {});
  };
  $('#s-del').onclick = (e) => {
    if (!confirm(`Удалить ситуацию «${x.title}»?`)) return;
    busy(e.currentTarget, () => store.remove('situations', x.id))
      .then(() => { S.dirty = false; location.hash = '#/hq/situations'; }).catch(() => {});
  };
}

async function seedSituations() {
  const byName = Object.fromEntries(S.roles.map((r) => [r.name.trim().toLowerCase(), r.id]));
  const have = new Set(S.situations.map((x) => x.title.trim().toLowerCase()));
  let t = Date.now();
  for (const s of SEED_SITUATIONS) {
    if (have.has(s.title.toLowerCase())) continue;
    const byRole = {};
    for (const [name, text] of Object.entries(s.byRoleName)) {
      const id = byName[name.toLowerCase()];
      if (id) byRole[id] = text;
    }
    await store.save('situations', null, { title: s.title, description: '', common: s.common, byRole, createdAt: t++ });
  }
}

// --- карты
function hqMaps(app) {
  app.innerHTML = `
    <div class="page-head">
      <div><h1>Карты</h1><p class="muted">Скриншоты карт или локаций из игры, на них рисуются схемы тактик.</p></div>
      <button class="btn primary" id="add-map">+ Загрузить карту</button>
    </div>
    <div class="grid three">
      ${S.maps.map((m) => `<article class="card map-card">
        <div class="thumb big" style="background-image:url('${m.image}')"></div>
        <div class="row between"><b>${esc(m.name)}</b><button class="btn ghost sm danger" data-del="${m.id}">Удалить</button></div>
        <span class="muted sm">в тактиках: ${S.tactics.filter((t) => t.mapId === m.id).length}</span>
      </article>`).join('') || '<p class="muted">Карт пока нет. Без карты схемы рисуются на сетке.</p>'}
    </div>`;
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
    <div class="page-head"><div><h1>Профиль</h1><p class="muted">@${esc(m.login)} · ${ACCESS[m.access].name} · ${roleBadge(roleOf(m))}</p></div></div>
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
