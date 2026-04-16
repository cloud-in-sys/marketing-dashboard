import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getAppCheck } from 'firebase-admin/app-check';

// On Cloud Run, Application Default Credentials are provided automatically.
// Locally: set GOOGLE_APPLICATION_CREDENTIALS=path/to/serviceAccountKey.json
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: process.env.GCP_PROJECT_ID,
  });
}

export const db = getFirestore();
export const auth = getAuth();
export const appCheck = getAppCheck();
export { admin };
