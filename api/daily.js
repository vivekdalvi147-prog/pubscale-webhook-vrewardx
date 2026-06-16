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

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: "Method not allowed. Use POST request." });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: "Missing or invalid authorization context." });
  }

  if (!firebaseInitialized || !db) {
    return res.status(503).json({
      success: false,
      error: "Firebase administration handshake was offline. Please configure FIREBASE credentials in Vercel settings."
    });
  }

  const idToken = authHeader.split('Bearer ')[1];

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const uid = decodedToken.uid;

    // 1. Check if the user has completed at least 1 Pubscale offer in RTDB
    let hasCompletedOffer = false;
    
    // Check user first in RTDB
    const userSnapshot = await rtdb.ref(`users/${uid}`).get();
    if (!userSnapshot.exists()) {
      return res.status(404).json({ success: false, error: "User record does not exist." });
    }

    const userData = userSnapshot.val() || {};

    if (userData.hasCompletedOffer === true || (userData.completedPubscaleOffers || 0) > 0 || (userData.completedCount || 0) > 0) {
      hasCompletedOffer = true;
    }

    // Direct nested transaction scan (Immune to index errors, 100% reliable & index-free!)
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

    const lastClaimTime = userData.lastDailyClaimTime || 0;
    currentStreak = userData.dailyStreakDay || 1;

    // Convert timestamp to days since epoch in Indian Standard Time (IST)
    const getISTDaysSinceEpoch = (timestamp) => {
      if (!timestamp) return 0;
      const istTime = Number(timestamp) + (5.5 * 60 * 60 * 1000);
      return Math.floor(istTime / (24 * 60 * 60 * 1000));
    };

    const lastClaimDays = getISTDaysSinceEpoch(lastClaimTime);
    const nowDays = getISTDaysSinceEpoch(now);

    const isSameDay = lastClaimTime !== 0 && (lastClaimDays === nowDays);

    if (isSameDay) {
      return res.status(400).json({
        success: false,
        error: "Daily reward already claimed today! Come back tomorrow."
      });
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

    const currentCoins = userData.coins || 0;
    updatedCoins = currentCoins + coinsToReward;
    nextStreak = currentStreak >= 7 ? 1 : currentStreak + 1;

    // Save atomic update in RTDB
    await rtdb.ref(`users/${uid}`).update({
      coins: updatedCoins,
      dailyStreakDay: nextStreak,
      lastDailyClaimTime: now
    });

    // Write immutable daily login reward transaction to RTDB
    const dailyTxObj = {
      uid: uid,
      type: "EARN",
      title: `Daily Login Reward (Day ${currentStreak})`,
      details: `Claimed login bonus of +${coinsToReward} Coins!`,
      coinsAmount: coinsToReward,
      status: "SUCCESS",
      timestamp: now
    };
    await rtdb.ref(`transactions/DAILY_CLAIM_${uid}_${now}`).set(dailyTxObj);

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
    return res.status(500).json({ success: false, error: err.message });
  }
};
