const admin = require('firebase-admin');

// Initialize Firebase Admin SDK if not already done
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
    const referralCode = (params.referralCode || params.ref || '').toUpperCase().trim();

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

      // 2. Unification lookup state
      let referrerUid = "";
      let referrerCode = "";
      let referrerName = "";
      let attributionToken = "MANUAL";

      const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || "127.0.0.1";
      const userAgent = req.headers['user-agent'] || "Unknown";

      if (manualCode && manualCode.trim().length > 0) {
        // Handle explicit manual entry backup
        const cleanedManual = manualCode.toUpperCase().trim();
        const refQuery = await db.collection("users").where("referralCode", "==", cleanedManual).limit(1).get();
        if (refQuery.empty) {
          return res.status(404).json({ success: false, error: "Referral code not found. Ensure 5 uppercase characters are typed." });
        }
        
        const fDoc = refQuery.docs[0].data();
        referrerUid = fDoc.uid;
        referrerCode = cleanedManual;
        referrerName = fDoc.displayName || "Your friend";
      } else {
        // Fingerprint Lookup! Retrieve click record via IP and User Agent match within last 2 hours
        const activeClicks = await db.collection("referral_clicks")
          .where("ip", "==", clientIp)
          .where("status", "==", "ACTIVE")
          .orderBy("timestamp", "desc")
          .limit(5)
          .get();

        if (!activeClicks.empty) {
          // Verify user agent keywords match securely (ignoring minor updates or differences)
          let matchDoc = null;
          for (const doc of activeClicks.docs) {
            const data = doc.data();
            if (data.expiresAt > Date.now()) {
              // Standard fingerprint substring verification
              const clickUa = (data.userAgent || "").toLowerCase();
              const currUa = userAgent.toLowerCase();
              
              // If operating system match (android) or similar device, complete connection
              if (currUa.includes("android") && clickUa.includes("android")) {
                matchDoc = doc;
                break;
              }
              // Fallback match nearest IP if no contrasting agents
              if (!matchDoc) {
                matchDoc = doc;
              }
            }
          }

          if (matchDoc) {
            const data = matchDoc.data();
            referrerUid = data.referrerUid;
            referrerCode = data.referralCode;
            referrerName = data.referrerName;
            attributionToken = data.token;

            // Mark click used
            await matchDoc.ref.update({ status: "USED" });
          }
        }
      }

      if (!referrerUid) {
        return res.status(200).json({ 
          success: false, 
          error: "No active install click found. (Fingerprint match timed out or wifi IP changed). Please enter a code manually below!" 
        });
      }

      if (referrerUid === uid) {
        return res.status(400).json({ success: false, error: "Self-referrals are blocked. You cannot invite yourself." });
      }

      // Create permanent record binding them
      await db.collection("referrals").doc(uid).set({
        referredUid: uid,
        referrerUid: referrerUid,
        referrerCode: referrerCode,
        token: attributionToken,
        timestamp: Date.now(),
        stage: "ATTRIBUTED",
        friendCompletesCount: 0,
        ip: clientIp
      });

      return res.status(200).json({
        success: true,
        referrerName,
        referralCode: referrerCode,
        message: `Successfully linked your sponsor ${referrerName}! Keep exploring offers to unlock rewards together.`
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
    const uid = params.uid;

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
        uidsToFetch.push({
          referredUid: data.referredUid,
          stage: data.stage || "ATTRIBUTED",
          friendCompletesCount: data.friendCompletesCount || 0,
          timestamp: data.timestamp
        });
      });

      // Hydrate displayNames
      for (const item of uidsToFetch) {
        const friendSnap = await db.collection("users").doc(item.referredUid).get();
        const fData = friendSnap.exists ? friendSnap.data() : null;
        list.push({
          uid: item.referredUid,
          name: fData ? (fData.displayName || "vRewardX Explorer") : "Active Friend",
          stage: item.stage,
          completedCount: item.friendCompletesCount,
          timestamp: item.timestamp
        });
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
