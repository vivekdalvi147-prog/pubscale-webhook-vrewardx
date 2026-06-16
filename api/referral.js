const { admin, db, rtdb, firebaseInitialized, syncSet, syncUpdate } = require('./firebase');
const crypto = require('crypto');

// Memory rate limit cache
const rateLimitCache = new Map();

function isRateLimited(ip, endpoint, limit = 10, windowMs = 60000) {
  const key = `${ip}:${endpoint}`;
  const now = Date.now();
  if (!rateLimitCache.has(key)) {
    rateLimitCache.set(key, []);
  }
  const requests = rateLimitCache.get(key).filter(time => now - time < windowMs);
  if (requests.length >= limit) {
    return true;
  }
  requests.push(now);
  rateLimitCache.set(key, requests);
  return false;
}

const getClientIp = (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const parts = forwarded.split(',');
    return parts[0].trim();
  }
  return req.socket.remoteAddress || "127.0.0.1";
};

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization, X-Firebase-AppCheck'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const clientIp = getClientIp(req);
  const url = req.url || '';

  if (url.includes('/claim')) {
    // ----------------------------------------------------
    // POST /api/referral/claim
    // Secure S2S Claim handler for manually linking code
    // ----------------------------------------------------
    if (req.method !== 'POST') {
      return res.status(405).json({ success: false, error: "Method not allowed. Use POST request." });
    }

    // Rate Limiting Check
    if (isRateLimited(clientIp, "referral_claim", 10, 60000)) {
      return res.status(429).json({ success: false, error: "Rate limit exceeded. Please wait a moment." });
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: "Missing or invalid authorization token" });
    }

    const idToken = authHeader.split('Bearer ')[1];
    const { manualCode } = req.body;

    if (!firebaseInitialized || !rtdb) {
      return res.status(503).json({ 
        success: false, 
        error: "Database connection offline." 
      });
    }

    // App Check Verification (Optional if header present)
    const appCheckToken = req.headers['x-firebase-appcheck'];
    if (appCheckToken) {
      try {
        await admin.appCheck().verifyToken(appCheckToken);
      } catch (e) {
        return res.status(403).json({ success: false, error: "Security check failed: App Check invalid." });
      }
    }

    try {
      // Verify ID token with revoked checks
      const decodedToken = await admin.auth().verifyIdToken(idToken, true);
      const uid = decodedToken.uid;

      // 1. Double check inside RTDB if they are already referred to prevent double claims
      const referralDoc = await rtdb.ref(`referrals/${uid}`).get();
      if (referralDoc.exists()) {
        return res.status(400).json({ 
          success: false, 
          error: "This account has already claimed or assigned a referrer.",
          data: referralDoc.val()
        });
      }

      // 2. Unification lookup state (Manual entry ONLY)
      if (!manualCode || manualCode.trim().length === 0) {
        return res.status(400).json({ success: false, error: "Referral code is required. Please type your sponsor's 5-character referral code." });
      }

      const cleanedManual = manualCode.toUpperCase().trim();
      const refQuery = await rtdb.ref("users").orderByChild("referralCode").equalTo(cleanedManual).limitToFirst(1).get();
      if (!refQuery.exists()) {
        return res.status(404).json({ success: false, error: "Referral code not found. Please verify the code and try again." });
      }

      let fDoc = null;
      refQuery.forEach(child => {
        fDoc = child.val();
      });
      const referrerUid = fDoc.uid;
      const referrerCode = cleanedManual;
      const referrerName = fDoc.displayName || "Your friend";

      if (referrerUid === uid) {
        return res.status(400).json({ success: false, error: "Self-referrals are blocked. You cannot invite yourself." });
      }

      // Check for mutual / circular referrals
      const circularCheckDoc = await rtdb.ref(`referrals/${referrerUid}`).get();
      if (circularCheckDoc.exists()) {
        const circularData = circularCheckDoc.val() || {};
        if (circularData.referrerUid === uid) {
          return res.status(400).json({
            success: false,
            error: "Mutual referral blocked. Since this user linked your code, you cannot link theirs."
          });
        }
      }

      const currentTimestamp = Date.now();

      // Fetch referred friend's display name for transaction list clarity
      const friendSnap = await rtdb.ref(`users/${uid}`).get();
      const friendName = friendSnap.exists() ? (friendSnap.val().displayName || "Active Friend") : "Invited Friend";

      // Credit +31 coins inside referrer's account (User B, the sponsor) atomically
      let referrerUpdated = false;
      await rtdb.ref(`users/${referrerUid}`).transaction((userData) => {
        if (!userData) return userData;
        userData.coins = (parseFloat(userData.coins || 0) || 0) + 31;
        referrerUpdated = true;
        return userData;
      });

      if (!referrerUpdated) {
        return res.status(500).json({ success: false, error: "Failed to link referral code safely. Please try again." });
      }

      // Save transaction log for the Referrer who gets +31 Coins with UUID/collision-immune format
      const rTxId = `REF_LINK_SPONSOR_${referrerUid}_${currentTimestamp}_${crypto.randomBytes(4).toString('hex')}`;
      const referrerTxObj = {
        uid: referrerUid,
        type: "EARN",
        title: "Referral Link Bonus",
        details: `Friend ${friendName} linked your invitation code! (+31 Coins)`,
        coinsAmount: 31,
        status: "SUCCESS",
        timestamp: currentTimestamp
      };
      await syncSet("transactions", rTxId, referrerTxObj);

      // Trigger persistent broadcast config alert to push system notification to the Sponsor with official title
      const broadcastObj = {
        title: "🎉 Friend Linked Your Code!",
        message: `Your friend ${friendName} manually linked your invitation code!`,
        clickUrl: "",
        imageUrl: "https://i.ibb.co/958hp8y/reward.jpg",
        timestamp: currentTimestamp,
        targetUids: [referrerUid]
      };
      await syncSet("config", "broadcast", broadcastObj);

      // Create permanent record binding them in both DB stores
      const referralObj = {
        referredUid: uid,
        referrerUid: referrerUid,
        referrerCode: referrerCode,
        token: "MANUAL",
        timestamp: currentTimestamp,
        stage: "ATTRIBUTED",
        friendCompletesCount: 0,
        ip: clientIp
      };
      await syncSet("referrals", uid, referralObj);

      return res.status(200).json({
        success: true,
        referrerName,
        referralCode: referrerCode,
        message: `Successfully linked referral code of ${referrerName}! Your friend received +31 Coins instantly!`
      });

    } catch (err) {
      console.error("Error processing claim:", err);
      return res.status(500).json({ success: false, error: "An internal server error occurred while processing referral claims." });
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

    // Rate Limiting Check
    if (isRateLimited(clientIp, "referral_list", 30, 60000)) {
      return res.status(429).json({ success: false, error: "Rate limit exceeded. Please try again after some time." });
    }

    try {
      // Find referrals we sponsored
      const snapshot = await rtdb.ref("referrals").orderByChild("referrerUid").equalTo(uid).get();
      const list = [];
      
      const uidsToFetch = [];
      if (snapshot.exists()) {
        snapshot.forEach(child => {
          const data = child.val();
          const refId = data.referredUid || child.key;
          if (refId && typeof refId === 'string' && refId.trim() !== '') {
            uidsToFetch.push({
              referredUid: refId.trim(),
              stage: data.stage || "ATTRIBUTED",
              friendCompletesCount: data.friendCompletesCount || 0,
              timestamp: data.timestamp || Date.now()
            });
          }
        });
      }

      // Hydrate displayNames
      for (const item of uidsToFetch) {
        if (!item.referredUid) continue;
        try {
          const friendSnap = await rtdb.ref(`users/${item.referredUid}`).get();
          const fData = friendSnap.exists() ? friendSnap.val() : null;
          list.push({
            uid: item.referredUid,
            name: fData ? (fData.displayName || "vRewardX Explorer") : "Active Friend",
            stage: item.stage,
            completedCount: item.friendCompletesCount,
            timestamp: item.timestamp
          });
        } catch (errDoc) {
          console.error("Failed to fetch user doc for referral list hydration:", item.referredUid, errDoc);
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
      return res.status(500).json({ success: false, error: "An internal server error occurred while retrieving referral lists." });
    }

  } else {
    // Default fallback
    return res.status(200).json({
      success: true,
      message: "vRewardX Secure APK Referral Routing Suite active."
    });
  }
};
