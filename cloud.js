import { FIREBASE_CONFIG, isConfigured } from './firebase-config.js?v=mvrlrtp9';

/**
 * Accounts and the shared vault, on Firebase.
 *
 * This is what makes the vault follow you between devices: the profile lives
 * in Firestore under your account rather than in one browser's storage. The
 * SDK is only fetched when a project is actually configured, so an
 * unconfigured site stays exactly as fast as before.
 *
 * Every call rejects with a plain-English `message`, because these strings go
 * straight onto the sign-in screen.
 */

const SDK = 'https://www.gstatic.com/firebasejs/10.14.1/';

let mods = null;
let app = null;
let auth = null;
let db = null;
let saveTimer = null;
let pending = null;

export { isConfigured };

async function load() {
  if (mods) return mods;
  const [core, authMod, store] = await Promise.all([
    import(`${SDK}firebase-app.js`),
    import(`${SDK}firebase-auth.js`),
    import(`${SDK}firebase-firestore.js`),
  ]);
  mods = { core, authMod, store };
  return mods;
}

export async function initCloud() {
  if (!isConfigured()) return false;
  const { core, authMod, store } = await load();
  app = core.initializeApp(FIREBASE_CONFIG);
  auth = authMod.getAuth(app);
  db = store.getFirestore(app);
  // Stay signed in across reloads and tabs.
  await authMod.setPersistence(auth, authMod.browserLocalPersistence).catch(() => {});
  return true;
}

/** Fires with the signed-in user, or null, and again on every change. */
export function onAuth(callback) {
  if (!auth) return () => {};
  return mods.authMod.onAuthStateChanged(auth, (user) => {
    callback(user ? { uid: user.uid, email: user.email, name: user.displayName || '' } : null);
  });
}

function friendlyError(err) {
  const code = (err && err.code) || '';
  const map = {
    'auth/invalid-email': 'That does not look like an email address.',
    'auth/missing-password': 'Enter a password.',
    'auth/weak-password': 'Use at least 6 characters for the password.',
    'auth/email-already-in-use': 'There is already an account with that email. Sign in instead.',
    'auth/invalid-credential': 'Wrong email or password.',
    'auth/wrong-password': 'Wrong email or password.',
    'auth/user-not-found': 'No account with that email. Create one instead.',
    'auth/too-many-requests': 'Too many attempts. Wait a minute and try again.',
    'auth/network-request-failed': 'Could not reach the server. Check your connection.',
    'auth/operation-not-allowed':
      'Email sign-in is not switched on for this project yet — enable it in the Firebase console under Authentication.',
  };
  const e = new Error(map[code] || (err && err.message) || 'Something went wrong.');
  e.code = code;
  return e;
}

export async function signUp(email, password, name) {
  try {
    const { authMod } = mods;
    const cred = await authMod.createUserWithEmailAndPassword(auth, email.trim(), password);
    if (name) await authMod.updateProfile(cred.user, { displayName: name });
    return { uid: cred.user.uid, email: cred.user.email, name };
  } catch (err) {
    throw friendlyError(err);
  }
}

export async function signIn(email, password) {
  try {
    const cred = await mods.authMod.signInWithEmailAndPassword(auth, email.trim(), password);
    return { uid: cred.user.uid, email: cred.user.email, name: cred.user.displayName || '' };
  } catch (err) {
    throw friendlyError(err);
  }
}

export async function signOutUser() {
  flush();
  if (auth) await mods.authMod.signOut(auth);
}

export async function resetPassword(email) {
  try {
    await mods.authMod.sendPasswordResetEmail(auth, email.trim());
  } catch (err) {
    throw friendlyError(err);
  }
}

// ---------------------------------------------------------------- profile

function docFor(uid) {
  return mods.store.doc(db, 'players', uid);
}

/** The stored profile, or null when this account has never played. */
export async function loadProfile(uid) {
  const snap = await mods.store.getDoc(docFor(uid));
  return snap.exists() ? snap.data() : null;
}

export async function createProfile(uid, profile) {
  await mods.store.setDoc(docFor(uid), profile);
}

/**
 * Writes are debounced: a stack changes on every single betting action, and
 * one network round trip per chip movement would be both slow and wasteful.
 */
export function saveProfile(uid, profile) {
  if (!db) return;
  pending = { uid, profile: { ...profile } };
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 1500);
}

export function flush() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!pending || !db) return;
  const { uid, profile } = pending;
  pending = null;
  mods.store.setDoc(docFor(uid), profile, { merge: true }).catch(() => {
    // Offline or refused: the local mirror still holds it, and the next
    // write retries. Never let a failed save interrupt a hand.
  });
}

// A last-chance save when the tab goes away.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flush);
}
