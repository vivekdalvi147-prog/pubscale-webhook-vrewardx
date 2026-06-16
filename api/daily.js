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
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization, X-Firebase-AppCheck'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: "Method not allowed. Use POST request." });
  }

  const clientIp = getClientIp(req);

  // Rate Limiting Check
  if (isRateLimited(clientIp, "daily", 10, 60000)) {
    return res.status(429).json({ success: false, error: "Rate limit exceeded. Please try again after some time." });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: "Missing or invalid authorization context." });
  }

  if (!firebaseInitialized || !rtdb) {
    return res.status(503).json({
      success: false,
      error: "Firebase database connection offline."
    });
  }

  // App Check Verification (Optional verify if header exists, otherwise log it)
  const appCheckToken = req.headers['x-firebase-appcheck'];
  if (appCheckToken) {
    try {
      await admin.appCheck().verifyToken(appCheckToken);
    } catch (e) {
      return res.status(403).json({ success: false, error: "Security check failed: App Check token invalid." });
    }
  }

  const idToken = authHeader.split('Bearer ')[1];

  try {
    // 1. Verify standard Firebase Auth ID Token securely on server-side WITH revoked token checks
    const decodedToken = await admin.auth().verifyIdToken(idToken, true);
    const uid = decodedToken.uid;

    // First check has completed offer to confirm eligibility
    let hasCompletedOffer = false;
    const userSnapshot = await rtdb.ref(`users/${uid}`).get();
    if (!userSnapshot.exists()) {
      return res.status(404).json({ success: false, error: "User record does not exist." });
    }

    const userDataVal = userSnapshot.val() || {};
    if (userDataVal.hasCompletedOffer === true || (userDataVal.completedPubscaleOffers || 0) > 0 || (userDataVal.completedCount || 0) > 0) {
      hasCompletedOffer = true;
    }

    if (!hasCompletedOffer) {
      try {
        const nestedTxQuery = await rtdb.ref(`transactions/${uid}`).get();
        if (nestedTxQuery.exists()) {
          nestedTxQuery.forEach(child => {
            const title = child.val().title || "";
            const details = child.val().details || "";
            if (
              title.toLowerCase().includes("pubscale") || 
              title.toLowerCase().includes("offer") ||
              details.toLowerCase().includes("pubscale") ||
              details.toLowerCase().includes("offer")
            ) {
              hasCompletedOffer = true;
            }
          });
        }
      } catch (errNested) {
        console.warn("Nested transactions query failed gracefully:", errNested.message);
      }
    }

    if (!hasCompletedOffer) {
      return res.status(400).json({
        success: false,
        error: "You must complete at least 1 PubScale Offer first! Complete public live campaigns in the Home Tab first."
      });
    }

    let coinsToReward = 5;
    let nextStreak = 1;
    let currentStreak = 1;
    let updatedCoins = 0;
    const now = Date.now();

    // Convert timestamp to days since epoch in Indian Standard Time (IST)
    const getISTDaysSinceEpoch = (timestamp) => {
      if (!timestamp) return 0;
      const istTime = Number(timestamp) + (5.5 * 60 * 60 * 1000);
      return Math.floor(istTime / (24 * 60 * 60 * 1000));
    };

    let txError = null;

    // RUN ACCESSIBLE BALANCES TRANSACTIONALLY IN AIRTIGHT MANNER TO PREVENT DOUBLE CLAIM RACE CONDITIONS!
    const txResult = await rtdb.ref(`users/${uid}`).transaction((userData) => {
      if (userData === null) {
        return userData; // Load real remote states
      }

      const lastClaimTime = userData.lastDailyClaimTime || 0;
      currentStreak = userData.dailyStreakDay || 1;

      const lastClaimDays = getISTDaysSinceEpoch(lastClaimTime);
      const nowDays = getISTDaysSinceEpoch(now);

      const isSameDay = lastClaimTime !== 0 && (lastClaimDays === nowDays);

      if (isSameDay) {
        txError = "Daily reward already claimed today! Come back tomorrow.";
        return; // Aborts transaction
      }

      // Determine streak resets or value
      if (lastClaimTime > 0 && nowDays > lastClaimDays + 1) {
        currentStreak = 1;
      }

      coinsToReward = {
        1: 5,
        2: 6,
        3: 8,
        4: 10,
        5: 12,
        6: 15,
        7: 20
      }[currentStreak] || 5;

      const currentCoins = parseFloat(userData.coins || 0) || 0;
      updatedCoins = currentCoins + coinsToReward;
      nextStreak = currentStreak >= 7 ? 1 : currentStreak + 1;

      userData.coins = updatedCoins;
      userData.dailyStreakDay = nextStreak;
      userData.lastDailyClaimTime = now;

      return userData;
    });

    if (txError) {
      return res.status(400).json({ success: false, error: txError });
    }

    if (!txResult.committed) {
      return res.status(500).json({ success: false, error: "The claim operation was busy. Please retry in a moment." });
    }

    // Write immutable daily login reward transaction with unique non-collision suffix
    const randomSuffix = crypto.randomBytes(4).toString('hex');
    const txId = `DAILY_CLAIM_${uid}_${now}_${randomSuffix}`;
    const dailyTxObj = {
      uid: uid,
      type: "EARN",
      title: `Daily Login Reward (Day ${currentStreak})`,
      details: `Claimed login bonus of +${coinsToReward} Coins!`,
      coinsAmount: coinsToReward,
      status: "SUCCESS",
      timestamp: now
    };
    await rtdb.ref(`transactions/${txId}`).set(dailyTxObj);

    return res.status(200).json({
      success: true,
      coins: coinsToReward,
      newCoins: updatedCoins,
      streakDay: nextStreak,
      lastClaimTime: now,
      message: `Successfully claimed Day ${currentStreak} Daily Reward of +${coinsToReward} Coins!`
    });

  } catch (err) {
    console.error("Error claiming daily login coins:", err);
    return res.status(500).json({ success: false, error: "An internal server error occurred while processing daily claims." });
  }
};
