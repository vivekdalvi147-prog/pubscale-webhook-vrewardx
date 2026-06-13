const admin = require('firebase-admin');

// Initialize Firebase Admin SDK if not already done
let db = null;
let firebaseInitialized = false;

// bol-ai <DOCTYPE HTML> 
//<HTMLAllCollection
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
  console.error("Firebase Admin initialization error on referral:", e);
}

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (!firebaseInitialized || !db) {
    return res.status(503).json({
      success: false,
      error: "Firebase administration handshake was offline. Please configure FIREBASE credentials in Vercel settings."
    });
  }

  const url = req.url || '';
  
  // Differentiate endpoints: click, claim, list, or submit manual
  if (url.includes('/click')) {
    // ----------------------------------------------------
    // POST /api/referral/click
    // ----------------------------------------------------
    const params = req.method === 'GET' ? req.query : (req.body || {});
    let referralCode = (params.referralCode || params.ref || '').toUpperCase().trim();
    if (!referralCode) {
      try {
        const parsedUrl = require('url').parse(req.url, true);
        if (parsedUrl && parsedUrl.query) {
          referralCode = (parsedUrl.query.referralCode || parsedUrl.query.ref || '').toUpperCase().trim();
        }
      } catch (e) {}
    }

    if (!referralCode) {
      return res.status(400).json({ success: false, error: "Missing required reference parameter 'ref' or 'referralCode'." });
    }

    try {
      // Check if referrer exists with this code
      const referrerQuery = await db.collection("users").where("referralCode", "==", referralCode).limit(1).get();
      if (referrerQuery.empty) {
        return res.status(404).json({ success: false, error: "Referral code not found. Please verify standard 5-character invitation code." });
      }

      const referrer = referrerQuery.docs[0].data();
      const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || "127.0.0.1";
      const userAgent = req.headers['user-agent'] || "Unknown Browser";

      // Generate secure unique token
      const token = "token_" + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

      // Save click
      const clickId = "clk_" + Date.now() + "_" + Math.random().toString(36).substring(2, 6);
      await db.collection("referral_clicks").doc(clickId).set({
        token,
        referralCode,
        referrerUid: referrer.uid,
        referrerName: referrer.displayName || "Representative",
        ip,
        userAgent,
        timestamp: Date.now(),
        status: "ACTIVE",
        expiresAt: Date.now() + (2 * 60 * 60 * 1000) // 2 hours expiration
      });

      return res.status(200).json({
        success: true,
        token,
        referralCode,
        referrerName: referrer.displayName || "vRewardX member",
        message: `Secure click handshake registered for ${referrer.displayName}. This install is attributed for rewards!`
      });
    } catch (err) {
      console.error("Error logging click:", err);
      return res.status(500).json({ success: false, error: err.message });
    }

  } else if (url.includes('/claim')) {
    // ----------------------------------------------------
    // POST /api/referral/claim
    // ----------------------------------------------------
    if (req.method !== 'POST') {
      return res.status(405).json({ success: false, error: "Method not allowed. Use POST request." });
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: "Missing or invalid authorization context." });
    }

    const { manualCode } = req.body;
    const idToken = authHeader.split('Bearer ')[1];

    try {
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      const uid = decodedToken.uid;

      // 1. Check if already referred to prevent duplicating claims
      const referralDoc = await db.collection("referrals").doc(uid).get();
      if (referralDoc.exists) {
        return res.status(400).json({ 
          success: false, 
          error: "This account has already claimed or assigned a referrer.",
          data: referralDoc.data()
        });
      }

      // 2. Unification lookup state (Manual entry ONLY, no automatic click/fingerprints)
      if (!manualCode || manualCode.trim().length === 0) {
        return res.status(400).json({ success: false, error: "Referral code is required. Please type your sponsor's 5-character referral code." });
      }

      const cleanedManual = manualCode.toUpperCase().trim();
      const refQuery = await db.collection("users").where("referralCode", "==", cleanedManual).limit(1).get();
      if (refQuery.empty) {
        return res.status(404).json({ success: false, error: "Referral code not found. Please verify the code and try again." });
      }

      const fDoc = refQuery.docs[0].data();
      const referrerUid = fDoc.uid;
      const referrerCode = cleanedManual;
      const referrerName = fDoc.displayName || "Your friend";

      if (referrerUid === uid) {
        return res.status(400).json({ success: false, error: "Self-referrals are blocked. You cannot invite yourself." });
      }

      // Check for mutual / circular referrals (A cannot refer B if B already referred A)
      const circularCheckDoc = await db.collection("referrals").doc(referrerUid).get();
      if (circularCheckDoc.exists) {
        const circularData = circularCheckDoc.data() || {};
        if (circularData.referrerUid === uid) {
          return res.status(400).json({
            success: false,
            error: "Mutual referral blocked. Since this user linked your code, you cannot link theirs."
          });
        }
      }

      const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || "127.0.0.1";

      // 3. Reward only the Referred friend with 31 coins immediately!
      const referrerRef = db.collection("users").doc(referrerUid);
      const friendRef = db.collection("users").doc(uid);
      let updatedFriendCoins = 0;

      await db.runTransaction(async (transaction) => {
        const rSnap = await transaction.get(referrerRef);
        const fSnap = await transaction.get(friendRef);
        
        if (fSnap.exists) {
          const fData = fSnap.data();
          const currentCoins = fData.coins || 0;
          updatedFriendCoins = currentCoins + 31;
          transaction.update(friendRef, { coins: updatedFriendCoins });
        }
      });

      // Fetch referred friend's display name for transaction list clarity
      const friendSnap = await db.collection("users").doc(uid).get();
      const friendName = friendSnap.exists ? (friendSnap.data().displayName || "Active Friend") : "Invited Friend";

      // 4. Save transaction log ONLY for the Referred friend who gets +31 Coins
      const fTxId = `REF_LINK_${uid}_${referrerUid}_${Date.now()}`;
      await db.collection("transactions").doc(fTxId).set({
        uid: uid,
        type: "EARN",
        title: "Referral Reward",
        details: `Linked referral code of ${referrerName}! (+31 Coins)`,
        coinsAmount: 31,
        status: "SUCCESS",
        timestamp: Date.now()
      });

      // 5. Trigger persistent broadcast config alert to push system notification to the Referrer
      await db.collection("config").doc("broadcast").set({
        title: "🎉 Friend Linked Your Code!",
        message: `${friendName} used your referral code ${referrerCode}! You will receive +100 Coins when they complete their first task.`,
        clickUrl: "",
        imageUrl: "https://i.ibb.co/6N6K4zS/reward.png",
        timestamp: Date.now(),
        targetUids: [referrerUid]
      });

      // 6. Create permanent record binding them
      await db.collection("referrals").doc(uid).set({
        referredUid: uid,
        referrerUid: referrerUid,
        referrerCode: referrerCode,
        token: "MANUAL",
        timestamp: Date.now(),
        stage: "ATTRIBUTED",
        friendCompletesCount: 0,
        ip: clientIp
      });

      return res.status(200).json({
        success: true,
        referrerName,
        referralCode: referrerCode,
        message: `Successfully linked your sponsor ${referrerName}! You received +31 Coins instantly in your wallet.`
      });

    } catch (err) {
      console.error("Error processing claim:", err);
      return res.status(500).json({ success: false, error: err.message });
    }

  } else if (url.includes('/list')) {
    // ----------------------------------------------------
    // GET /api/referral/list?uid=USER_UID
    // Retrieves your referred friends lists and status
    // ----------------------------------------------------
    const params = req.method === 'GET' ? req.query : (req.body || {});
    let uid = params.uid;
    if (!uid) {
      try {
        const parsedUrl = require('url').parse(req.url, true);
        if (parsedUrl && parsedUrl.query && parsedUrl.query.uid) {
          uid = parsedUrl.query.uid;
        }
      } catch (e) {}
    }

    if (!uid) {
      return res.status(400).json({ success: false, error: "Missing required parameter 'uid'." });
    }

    try {
      // Find referrals we sponsored
      const snapshot = await db.collection("referrals").where("referrerUid", "==", uid).get();
      const list = [];
      
      const uidsToFetch = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        const refId = data.referredUid || doc.id;
        if (refId && typeof refId === 'string' && refId.trim() !== '') {
          uidsToFetch.push({
            referredUid: refId.trim(),
            stage: data.stage || "ATTRIBUTED",
            friendCompletesCount: data.friendCompletesCount || 0,
            timestamp: data.timestamp || Date.now()
          });
        }
      });

      // Hydrate displayNames
      for (const item of uidsToFetch) {
        if (!item.referredUid || typeof item.referredUid !== 'string' || item.referredUid.trim() === '') {
          continue;
        }
        try {
          const friendSnap = await db.collection("users").doc(item.referredUid).get();
          const fData = friendSnap.exists ? friendSnap.data() : null;
          list.push({
            uid: item.referredUid,
            name: fData ? (fData.displayName || "vRewardX Explorer") : "Active Friend",
            stage: item.stage,
            completedCount: item.friendCompletesCount,
            timestamp: item.timestamp
          });
        } catch (errDoc) {
          console.error("Failed to fetch user doc for referral item:", item.referredUid, errDoc);
        }
      }

      // Sort by joining time descending
      list.sort((a, b) => b.timestamp - a.timestamp);

      return res.status(200).json({
        success: true,
        referrals: list
      });
    } catch (err) {
      console.error("Error listing referrals:", err);
      return res.status(500).json({ success: false, error: err.message });
    }

  } else {
    // Default fallback
    return res.status(200).json({
      success: true,
      message: "vRewardX Secure APK Referral Routing Suite active."
    });
  }
};
