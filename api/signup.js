const { admin, db, rtdb, firebaseInitialized, syncSet, syncUpdate } = require('./firebase');

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

    const userSnapshot = await rtdb.ref(`users/${uid}`).get();

    let userCoins = 50; // Starting Welcome Bonus credited securely via backend logic
    let isNewUser = false;

    if (!userSnapshot.exists()) {
      isNewUser = true;

      // Anti-cheat verification 1: Multi-device registry tracking to deny multiple accounts claiming bonus
      if (deviceId) {
        const deviceSnapshot = await rtdb.ref(`devices/${deviceId}`).get();
        if (deviceSnapshot.exists() && deviceSnapshot.val().uid !== uid) {
          // Device has already linked with another user id previously! Prevent duplicate 50 welcome bonus.
          userCoins = 0;
        } else {
          // Map device to this authenticated user safely across both DB stores
          await syncSet("devices", deviceId, {
            uid: uid,
            email: userEmail.toLowerCase().trim()
          });
        }
      }

      // Anti-cheat verification 2: Check standard transactional WELCOME document to protect against race conditions
      const welcomeTxSnap = await rtdb.ref(`transactions/${uid}_WELCOME`).get();
      if (welcomeTxSnap.exists()) {
        userCoins = 0;
      }

      // 2. Generate standard 5-character alphanumeric referral code securely
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      let referralCode = '';
      let isUnique = false;
      let checkAttempts = 0;
      while (!isUnique && checkAttempts < 5) {
        let code = '';
        for (let i = 0; i < 5; i++) {
          code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        const existingDocs = await rtdb.ref("users").orderByChild("referralCode").equalTo(code).limitToFirst(1).get();
        if (!existingDocs.exists()) {
          referralCode = code;
          isUnique = true;
        }
        checkAttempts++;
      }
      if (!isUnique) {
        referralCode = uid.substring(0, 5).toUpperCase();
      }

      // 3. Create authoritative Google User inside both Firestore and RTDB
      const newUserObj = {
        uid: uid,
        displayName: name,
        email: userEmail.toLowerCase().trim(),
        coins: userCoins,
        lockedCoins: 0,
        upiId: "",
        androidId: deviceId || "unknown",
        deviceId: deviceId || "unknown",
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || "127.0.0.1",
        isBlocked: false,
        referralCode: referralCode,
        dailyStreakDay: 1,
        lastDailyClaimTime: 0
      };
      await syncSet("users", uid, newUserObj);

      // Write immutable starting reward welcome logs to transactions DB
      if (userCoins > 0) {
        const welcomeTxObj = {
          uid: uid,
          type: "EARN",
          title: "Registration Welcome Bonus",
          details: "Approved 50 coins securely credited topup.",
          coinsAmount: 50,
          status: "SUCCESS",
          timestamp: Date.now()
        };
        await syncSet("transactions", `${uid}_WELCOME`, welcomeTxObj);
      }
    } else {
      // Return authoritative profile details
      const existingData = userSnapshot.val();
      userCoins = existingData.coins !== undefined ? existingData.coins : 0;
      
      // Auto-assign code if missing
      if (!existingData.referralCode) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let referralCode = '';
        let isUnique = false;
        let checkAttempts = 0;
        while (!isUnique && checkAttempts < 5) {
          let code = '';
          for (let i = 0; i < 5; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
          }
          const existingDocs = await rtdb.ref("users").orderByChild("referralCode").equalTo(code).limitToFirst(1).get();
          if (!existingDocs.exists()) {
            referralCode = code;
            isUnique = true;
          }
          checkAttempts++;
        }
        if (!isUnique) {
          referralCode = uid.substring(0, 5).toUpperCase();
        }
        await syncUpdate("users", uid, { referralCode: referralCode });
      }
    }

    // Grab final updated doc
    const updatedSnap = await rtdb.ref(`users/${uid}`).get();
    const finalData = updatedSnap.val();

    return res.status(200).json({
      success: true,
      uid: uid,
      isNewUser: isNewUser,
      coins: userCoins,
      referralCode: finalData.referralCode,
      message: isNewUser 
        ? (userCoins > 0 ? "Signup verified successfully! Welcome 50-coins bonus credited from server." : "Signup verified. Starting balance is 0 to avoid multi-account fraud.")
        : "Re-synced authenticated profile successfully."
    });

  } catch (error) {
    console.error("Secure signup validation failed:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};
