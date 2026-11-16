// Демо-хранилище в localStorage: тот же интерфейс, что у Firebase, но только в этом браузере.
const KEY = 'nightmare-demo-v1';
const SESSION = 'nightmare-demo-session';

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)).replace(/-/g, '').slice(0, 20);
const clone = (o) => JSON.parse(JSON.stringify(o));

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; }
}

export function createLocalBackend() {
  let db = load() || { users: {}, meta: {}, members: {}, roles: {}, tactics: {}, maps: {} };
  for (const k of ['users', 'meta', 'members', 'roles', 'tactics', 'maps', 'situations']) db[k] = db[k] || {};
  const subs = {};
  let authCb = null;
  let current = null;
  try { current = JSON.parse(localStorage.getItem(SESSION)); } catch { /* ignore */ }

  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { console.warn(e); } };
  const list = (name) => Object.entries(db[name] || {}).map(([id, v]) => ({ id, ...clone(v) }));
  const emit = (name) => (subs[name] || []).forEach((cb) => cb(list(name)));
  const setSession = (u) => {
    current = u;
    try { u ? localStorage.setItem(SESSION, JSON.stringify(u)) : localStorage.removeItem(SESSION); } catch { /* ignore */ }
    authCb && authCb(current);
  };
  const fail = (msg) => { throw new Error(msg); };
  const findUser = (login) => Object.entries(db.users).find(([, u]) => u.login === login.trim().toLowerCase());

  return {
    mode: 'local',

    onAuth(cb) { authCb = cb; setTimeout(() => cb(current), 0); return () => { authCb = null; }; },

    async isSetupDone() { return !!db.meta.setup; },

    async setupLeader({ login, password, nick }, seedRoles) {
      if (db.meta.setup) fail('Глава клана уже создан');
      if (findUser(login)) fail('Этот логин уже занят — выбери другой');
      const id = uid();
      db.users[id] = { login: login.toLowerCase(), password };
      db.meta.setup = { leaderUid: id, createdAt: Date.now() };
      db.members[id] = { nick, login: login.toLowerCase(), access: 'leader', roleId: '', createdAt: Date.now() };
      for (const r of seedRoles || []) db.roles[uid()] = clone(r);
      persist();
      setSession({ uid: id, login: login.toLowerCase() });
      return id;
    },

    async signIn(login, password) {
      const found = findUser(login);
      if (!found || found[1].password !== password) fail('Неверный логин или пароль');
      setSession({ uid: found[0], login: found[1].login });
    },

    async signOut() { setSession(null); },

    async changeMyPassword(oldPw, newPw) {
      const u = db.users[current.uid];
      if (u.password !== oldPw) fail('Неверный пароль');
      u.password = newPw; persist();
    },

    async createMember({ login, password, nick, access, roleId }) {
      if (findUser(login)) fail('Этот логин уже занят — выбери другой');
      const id = uid();
      db.users[id] = { login: login.toLowerCase(), password };
      db.members[id] = { nick, login: login.toLowerCase(), access, roleId: roleId || '', createdAt: Date.now() };
      persist(); emit('members');
      return id;
    },

    subscribe(name, cb) {
      (subs[name] = subs[name] || []).push(cb);
      setTimeout(() => cb(list(name)), 0);
      return () => { subs[name] = subs[name].filter((x) => x !== cb); };
    },

    async save(name, id, data) {
      id = id || uid();
      db[name][id] = clone(data); persist(); emit(name);
      return id;
    },

    async patch(name, id, fields) {
      const d = db[name][id];
      if (!d) fail('Документ не найден');
      for (const [path, val] of Object.entries(fields)) {
        const parts = path.split('.');
        let o = d;
        while (parts.length > 1) { const p = parts.shift(); o = o[p] = o[p] || {}; }
        o[parts[0]] = clone(val);
      }
      persist(); emit(name);
    },

    async remove(name, id) {
      delete db[name][id];
      if (name === 'members') delete db.users[id];
      persist(); emit(name);
    },
  };
}
