// One-shot migration: move users/{uid}/sources/* to top-level /sources/*
// Run:  GCP_PROJECT_ID=marketing-493303 node src/migrate-to-shared.js
// Uses Application Default Credentials (run `gcloud auth application-default login` first)

import { db } from './firebase.js';

async function migrate() {
  const existing = await db.collection('sources').limit(1).get();
  if (!existing.empty) {
    console.log('Shared sources already exist; aborting migration.');
    return;
  }

  const users = await db.collection('users').get();
  for (const userDoc of users.docs) {
    const uid = userDoc.id;
    const sourcesSnap = await userDoc.ref.collection('sources').get();
    for (const sourceDoc of sourcesSnap.docs) {
      const sid = sourceDoc.id;
      console.log(`Moving ${uid}/${sid} -> sources/${sid}`);
      const sourceData = { ...sourceDoc.data(), createdBy: uid };
      await db.collection('sources').doc(sid).set(sourceData);

      // config
      const configSnap = await sourceDoc.ref.collection('config').doc('current').get();
      if (configSnap.exists) {
        await db.collection('sources').doc(sid).collection('config').doc('current').set(configSnap.data());
      }

      // presets
      const presetsSnap = await sourceDoc.ref.collection('presets').get();
      for (const presetDoc of presetsSnap.docs) {
        await db.collection('sources').doc(sid).collection('presets').doc(presetDoc.id).set(presetDoc.data());
      }

      // Delete old
      for (const p of presetsSnap.docs) await p.ref.delete();
      if (configSnap.exists) await configSnap.ref.delete();
      await sourceDoc.ref.delete();
    }
  }
  console.log('Migration done.');
}

migrate().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
