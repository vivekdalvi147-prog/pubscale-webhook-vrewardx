const admin = require('firebase-admin');

let db = null;
let rtdb = null;
let firebaseInitialized = false;
let firebaseStatus = "Not Initialized";

try {
  const projectId = process.env.FIREBASE_PROJECT_ID || "vrewardx";
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (projectId && clientEmail && privateKey) {
    privateKey = privateKey.replace(/\\n/g, '\n').trim();
    if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
      privateKey = privateKey.substring(1, privateKey.length - 1).replace(/\\n/g, '\n');
    }

    const targetDbUrl = process.env.FIREBASE_DATABASE_URL || "https://vrewardx-default-rtdb.asia-southeast1.firebasedatabase.app";

    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          clientEmail,
          privateKey
        }),
        databaseURL: targetDbUrl
      });
    }
    db = admin.firestore();
    rtdb = admin.database();
    firebaseInitialized = true;
    firebaseStatus = `Connected successfully to firestore & RTDB: ${targetDbUrl}`;
    console.log(firebaseStatus);
  } else {
    // Attempt local emulator default fallback or soft passenger mode
    const targetDbUrl = process.env.FIREBASE_DATABASE_URL || "https://vrewardx-default-rtdb.asia-southeast1.firebasedatabase.app";
    if (!admin.apps.length) {
      admin.initializeApp({
        databaseURL: targetDbUrl
      });
    }
    db = admin.firestore();
    rtdb = admin.database();
    firebaseInitialized = true;
    firebaseStatus = `Connected using default credential fallback to project: '${projectId}'`;
    console.log(firebaseStatus);
  }
} catch (e) {
  firebaseStatus = `Firebase initialization error: ${e.message}`;
  console.error("Firebase Admin init error:", e);
}

// Global Sync helper to seamlessly keep RTDB & Firestore updated in lockstep
async function syncUpdate(collection, docId, data) {
  if (!firebaseInitialized) return;
  // 1. Update Firestore
  try {
    await db.collection(collection).doc(docId).update(data);
  } catch (err) {
    console.warn(`Firestore update fail at ${collection}/${docId}:`, err.message);
  }
  // 2. Update RTDB
  try {
    const cleanPath = `${collection}/${docId}`.replace(/\./g, '_');
    await rtdb.ref(cleanPath).update(data);
  } catch (err) {
    console.warn(`RTDB update fail at ${collection}/${docId}:`, err.message);
  }
}

async function syncSet(collection, docId, data) {
  if (!firebaseInitialized) return;
  // 1. Set Firestore
  try {
    await db.collection(collection).doc(docId).set(data);
  } catch (err) {
    console.warn(`Firestore set fail at ${collection}/${docId}:`, err.message);
  }
  // 2. Set RTDB
  try {
    const cleanPath = `${collection}/${docId}`.replace(/\./g, '_');
    await rtdb.ref(cleanPath).set(data);
  } catch (err) {
    console.warn(`RTDB set fail at ${collection}/${docId}:`, err.message);
  }
}

module.exports = {
  admin,
  db,
  rtdb,
  firebaseInitialized,
  firebaseStatus,
  syncUpdate,
  syncSet
};
