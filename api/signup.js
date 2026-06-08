const admin = require('firebase-admin');

// Initialize Firebase Admin SDK
let db = null;
let firebaseInitialized = false;

try {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (projectId && clientEmail && privateKey) {
    privateKey = privateKey.replace(/\\n/g, '\n').trim();
    if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
      privateKey = privateKey.substring(1, privateKey.length - 1).replace(/\\n/g, '\n');
    }

    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          clientEmail,
          privateKey
        })
      });
    }
    db = admin.firestore();
    firebaseInitialized = true;
  }
} catch (e) {
  console.error("Firebase Admin initialization error on signup:", e);
}

module.exports = async (req, res) => {
  // Enforce POST method for profile registration/auth operations
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: "Method not allowed. Use POST request." });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: "Missing or invalid authorization token" });
  }

  const idToken = authHeader.split('Bearer ')[1];
  const { displayName, email, deviceId } = req.body;

  if (!firebaseInitialized || !db) {
    return res.status(503).json({ 
      success: false, 
      error: "Firebase database connection was offline. Configure FIREBASE credentials on Vercel." 
    });
  }

  try {
    // 1. Verify standard Firebase Auth ID Token securely on the server side
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const uid = decodedToken.uid;
    const userEmail = decodedToken.email || email || "";
    const name = decodedToken.name || displayName || "Google User";

    const userRef = db.collection("users").doc(uid);
    const userSnapshot = await userRef.get();

    let userCoins = 50; // Starting Welcome Bonus credited securely via backend logic
    let isNewUser = false;

    if (!userSnapshot.exists) {
      isNewUser = true;

      // Anti-cheat verification 1: Multi-device registry tracking to deny multiple accounts claiming bonus
      if (deviceId) {
        const deviceDocRef = db.collection("devices").doc(deviceId);
        const deviceDoc = await deviceDocRef.get();
        if (deviceDoc.exists && deviceDoc.data().uid !== uid) {
          // Device has already linked with another user id previously! Prevent duplicate 50 welcome bonus.
          userCoins = 0;
        } else {
          // Map device to this authenticated user safely
          await deviceDocRef.set({
            uid: uid,
            email: userEmail.toLowerCase().trim()
          });
        }
      }

      // Anti-cheat verification 2: Check standard transactional WELCOME document to protect against race conditions
      const welcomeTxRef = db.collection("transactions").doc(`${uid}_WELCOME`);
      const welcomeTxSnap = await welcomeTxRef.get();
      if (welcomeTxSnap.exists) {
        userCoins = 0;
      }

      // 2. Create authoritative Google User inside cloud Firestore
      await userRef.set({
        uid: uid,
        displayName: name,
        email: userEmail.toLowerCase().trim(),
        coins: userCoins,
        lockedCoins: 0,
        upiId: "",
        androidId: deviceId || "unknown",
        deviceId: deviceId || "unknown",
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || "127.0.0.1",
        isBlocked: false
      });

      // Write immutable starting reward welcome logs to transactions DB
      if (userCoins > 0) {
        await welcomeTxRef.set({
          uid: uid,
          type: "EARN",
          title: "Registration Welcome Bonus",
          details: "Approved 50 coins securely credited topup.",
          coinsAmount: 50,
          status: "SUCCESS",
          timestamp: Date.now()
        });
      }
    } else {
      // Return authoritative profile details
      userCoins = userSnapshot.data().coins !== undefined ? userSnapshot.data().coins : 0;
    }

    return res.status(200).json({
      success: true,
      uid: uid,
      isNewUser: isNewUser,
      coins: userCoins,
      message: isNewUser 
        ? (userCoins > 0 ? "Signup verified successfully! Welcome 50-coins bonus credited from server." : "Signup verified. Starting balance is 0 to avoid multi-account fraud.")
        : "Re-synced authenticated profile successfully."
    });

  } catch (error) {
    console.error("Secure signup validation failed:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};
