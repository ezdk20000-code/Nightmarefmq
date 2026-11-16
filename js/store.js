import { firebaseConfig } from './firebase-config.js';
import { createLocalBackend } from './backend-local.js';

export async function createStore() {
  if (firebaseConfig.apiKey && firebaseConfig.projectId) {
    const { createFirebaseBackend } = await import('./backend-firebase.js');
    return createFirebaseBackend(firebaseConfig);
  }
  return createLocalBackend();
}
