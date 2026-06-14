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

    if (!firebaseInitialized || !db) {
      return res.status(503).json({ 
        success: false, 
        error: "Firebase database connection offline. Configure credentials on Vercel." 
      });
    }

    try {
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      const uid = decodedToken.uid;

      // 1. Double check inside Firestore if they are already referred to prevent double claims
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

      const referrerRef = db.collection("users").doc(referrerUid);
      const friendRef = db.collection("users").doc(uid);
      let updatedReferrerCoins = 0;

      // 3. Reward the Sponsor/Referrer (User B) with 31 coins immediately as requested by project rules!
      await db.runTransaction(async (transaction) => {
        const rSnap = await transaction.get(referrerRef);
        const fSnap = await transaction.get(friendRef);
        
        if (rSnap.exists) {
          const rData = rSnap.data();
          const currentCoins = rData.coins || 0;
          updatedReferrerCoins = currentCoins + 31;
          transaction.update(referrerRef, { coins: updatedReferrerCoins });
        }
      });

      // Fetch referred friend's display name for transaction list clarity
      const friendSnap = await db.collection("users").doc(uid).get();
      const friendName = friendSnap.exists ? (friendSnap.data().displayName || "Active Friend") : "Invited Friend";

      const currentTimestamp = Date.now();

      // 4. Save transaction log for the Referrer who gets +31 Coins in both DB stores
      const rTxId = `REF_LINK_${uid}_${referrerUid}_${currentTimestamp}`;
      const referrerTxObj = {
        uid: referrerUid,
        type: "EARN",
        title: "Referral Link Bonus",
        details: `${friendName} manually linked your referral code! (+31 Coins)`,
        coinsAmount: 31,
        status: "SUCCESS",
        timestamp: currentTimestamp
      };
      await syncSet("transactions", rTxId, referrerTxObj);

      // 5. Trigger persistent broadcast config alert to push system notification to the Referrer
      const broadcastObj = {
        title: "🎉 Friend Linked Your Code!",
        message: `${friendName} used your referral code ${referrerCode}! You received +31 Coins instantly.`,
        clickUrl: "",
        imageUrl: "https://i.ibb.co/6N6K4zS/reward.png",
        timestamp: currentTimestamp,
        targetUids: [referrerUid]
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

      // Sync referrer coins update to Realtime Database
      try {
        await rtdb.ref(`users/${referrerUid}`).update({
          coins: updatedReferrerCoins
        });
      } catch (e) {
        console.warn("RTDB referrer claim coins sync fail:", e);
      }

      return res.status(200).json({
        success: true,
        referrerName,
        referralCode: referrerCode,
        message: `Successfully linked your sponsor ${referrerName}! Friend received invitation bonus securely.`
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
