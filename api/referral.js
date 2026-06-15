const { admin, db, rtdb, firebaseInitialized, syncSet, syncUpdate } = require('./firebase');

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

  const url = req.url || '';

  if (url.includes('/claim')) {
    // ----------------------------------------------------
    // POST /api/referral/claim
    // Secure S2S Claim handler for manually linking code
    // ----------------------------------------------------
    if (req.method !== 'POST') {
      return res.status(405).json({ success: false, error: "Method not allowed. Use POST request." });
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
        error: "Firebase database connection offline. Configure credentials on Vercel." 
      });
    }

    try {
      const decodedToken = await admin.auth().verifyIdToken(idToken);
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

      // 2. Unification lookup state (Manual entry ONLY, no automatic click/fingerprints)
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

      // Check for mutual / circular referrals (A cannot refer B if B already referred A)
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

      const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || "127.0.0.1";

      let updatedUserCoins = 0;

      // Credit +31 coins inside referred user account (User B, who is linking the code)
      await rtdb.ref(`users/${uid}/coins`).transaction((currentCoins) => {
        const coins = (currentCoins || 0) + 31;
        updatedUserCoins = coins;
        return coins;
      });

      // Fetch referred friend's display name for transaction list clarity
      const friendSnap = await rtdb.ref(`users/${uid}`).get();
      const friendName = friendSnap.exists() ? (friendSnap.val().displayName || "Active Friend") : "Invited Friend";

      const currentTimestamp = Date.now();

      // Save transaction log for the Referred friend who gets +31 Coins in both DB stores
      const uTxId = `REF_LINK_SELF_${uid}_${currentTimestamp}`;
      const userTxObj = {
        uid: uid,
        type: "EARN",
        title: "Referral Reward",
        details: `Successfully linked to ${referrerName}'s code! (+31 Coins)`,
        coinsAmount: 31,
        status: "SUCCESS",
        timestamp: currentTimestamp
      };
      await syncSet("transactions", uTxId, userTxObj);

      // 5. Trigger persistent broadcast config alert to push system notification to BOTH the referrer and referred friend
      const broadcastObj = {
        title: "🎉 Referral Successful!",
        message: `${friendName} connected using referral code ${referrerCode}! [${friendName}] received +31 Coins instantly.`,
        clickUrl: "",
        imageUrl: "https://i.ibb.co/958hp8y/reward.jpg",
        timestamp: currentTimestamp,
        targetUids: [referrerUid, uid]
      };
      await syncSet("config", "broadcast", broadcastObj);

      // 6. Create permanent record binding them in both DB stores
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

      try {
        await rtdb.ref(`users/${uid}`).update({
          coins: updatedUserCoins
        });
      } catch (e) {
        console.warn("RTDB referred friend claim coins sync fail:", e);
      }

      return res.status(200).json({
        success: true,
        referrerName,
        referralCode: referrerCode,
        message: `Successfully linked referral code of ${referrerName}! You received +31 Coins instantly!`
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
        if (!item.referredUid || typeof item.referredUid !== 'string' || item.referredUid.trim() === '') {
          continue;
        }
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
