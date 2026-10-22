/**
 * Firebase connection details.
 *
 * Paste the config object from the Firebase console here (Project settings →
 * Your apps → Web app). These values are meant to be public: they identify
 * the project, they do not grant access. What actually protects the data is
 * the Firestore security rules, which are in the README.
 *
 * While apiKey and projectId are blank, the site runs exactly as before:
 * no sign-in, vault saved in this browser only.
 */
export const FIREBASE_CONFIG = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  storageBucket: '',
  messagingSenderId: '',
  appId: '',
};

export function isConfigured() {
  return Boolean(FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.projectId);
}
