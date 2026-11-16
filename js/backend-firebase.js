// Хранилище на Firebase (Auth + Firestore): общие данные для всего клана в реальном времени.
const V = '10.12.2';
const base = `https://www.gstatic.com/firebasejs/${V}`;

const { initializeApp, deleteApp } = await import(`${base}/firebase-app.js`);
const {
  getAuth, initializeAuth, inMemoryPersistence, onAuthStateChanged,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
  updatePassword, reauthenticateWithCredential, EmailAuthProvider
} = await import(`${base}/firebase-auth.js`);
const {
  getFirestore, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  collection, onSnapshot, writeBatch
} = await import(`${base}/firebase-firestore.js`);

const DOMAIN = 'nightmare-clan.app';
export const loginToEmail = (login) => `${login.trim().toLowerCase()}@${DOMAIN}`;
const emailToLogin = (email) => (email || '').split('@')[0];

const clean = (o) => JSON.parse(JSON.stringify(o));

function humanError(e) {
  const code = e && e.code || '';
  const map = {
    'auth/invalid-credential': 'Неверный логин или пароль',
    'auth/wrong-password': 'Неверный пароль',
    'auth/user-not-found': 'Такого логина нет',
    'auth/email-already-in-use': 'Этот логин уже занят — выбери другой',
    'auth/weak-password': 'Пароль слишком простой (минимум 6 символов)',
    'auth/too-many-requests': 'Слишком много попыток, подожди немного',
    'auth/network-request-failed': 'Нет связи с сервером',
    'permission-denied': 'Нет прав на это действие',
  };
  const err = new Error(map[code] || e.message || 'Ошибка');
  err.code = code;
  return err;
}
const wrap = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { throw humanError(e); } };

export function createFirebaseBackend(config) {
  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = getFirestore(app);

  return {
    mode: 'firebase',

    onAuth(cb) {
      return onAuthStateChanged(auth, (u) => cb(u ? { uid: u.uid, login: emailToLogin(u.email) } : null));
    },

    isSetupDone: wrap(async () => {
      const s = await getDoc(doc(db, 'meta', 'setup'));
      return s.exists();
    }),

    // Первый запуск: глава клана создаёт свой аккаунт.
    setupLeader: wrap(async ({ login, password, nick }, seedRoles) => {
      const cred = await createUserWithEmailAndPassword(auth, loginToEmail(login), password);
      const uid = cred.user.uid;
      const batch = writeBatch(db);
      batch.set(doc(db, 'meta', 'setup'), { leaderUid: uid, createdAt: Date.now() });
      batch.set(doc(db, 'members', uid), clean({
        nick, login: login.toLowerCase(), access: 'leader', roleId: '', createdAt: Date.now()
      }));
      await batch.commit();
      for (const r of seedRoles || []) await addDoc(collection(db, 'roles'), clean(r));
      return uid;
    }),

    signIn: wrap(async (login, password) => {
      await signInWithEmailAndPassword(auth, loginToEmail(login), password);
    }),

    signOut: wrap(async () => { await signOut(auth); }),

    changeMyPassword: wrap(async (oldPw, newPw) => {
      const u = auth.currentUser;
      await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, oldPw));
      await updatePassword(u, newPw);
    }),

    // Глава выдаёт доступ: создаём аккаунт через отдельный экземпляр приложения,
    // чтобы сам глава не вылетел из своей сессии.
    createMember: wrap(async ({ login, password, nick, access, roleId }) => {
      const tmp = initializeApp(config, 'tmp-' + Date.now());
      try {
        const tmpAuth = initializeAuth(tmp, { persistence: inMemoryPersistence });
        const cred = await createUserWithEmailAndPassword(tmpAuth, loginToEmail(login), password);
        const uid = cred.user.uid;
        await signOut(tmpAuth);
        await setDoc(doc(db, 'members', uid), clean({
          nick, login: login.toLowerCase(), access, roleId: roleId || '', createdAt: Date.now()
        }));
        return uid;
      } finally {
        await deleteApp(tmp);
      }
    }),

    subscribe(name, cb, onError) {
      return onSnapshot(collection(db, name),
        (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
        (e) => { console.error(name, e); onError && onError(humanError(e)); });
    },

    save: wrap(async (name, id, data) => {
      if (id) { await setDoc(doc(db, name, id), clean(data)); return id; }
      const ref = await addDoc(collection(db, name), clean(data));
      return ref.id;
    }),

    patch: wrap(async (name, id, fields) => { await updateDoc(doc(db, name, id), clean(fields)); }),

    remove: wrap(async (name, id) => { await deleteDoc(doc(db, name, id)); }),
  };
}
