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
  console.error("Firebase Admin initialization error on daily:", e);
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

    // 1. Check if the user has completed at least 1 Pubcale offer in Firestore
    let hasCompletedOffer = false;
    
    // Check 1: pubscale_callbacks collection
    const callbacksQuery = await db.collection("pubscale_callbacks").where("user_id", "==", uid).limit(1).get();
    if (!callbacksQuery.empty) {
      hasCompletedOffer = true;
    } else {
      // Check 2: transactions collection for "pubscale" or "offer" keyword in title
      const transactionsQuery = await db.collection("transactions").where("uid", "==", uid).get();
      transactionsQuery.forEach(doc => {
        const title = doc.data().title || "";
        if (title.toLowerCase().includes("pubscale") || title.toLowerCase().includes("offer")) {
          hasCompletedOffer = true;
        }
      });
    }

    if (!hasCompletedOffer) {
      return res.status(400).json({
        success: false,
        error: "You must complete at least 1 PubScale Offer first! Complete public live campaigns in the Home Tab first."
      });
    }

    const userRef = db.collection("users").doc(uid);
    let message = "";
    let coinsToReward = 5;
    let nextStreak = 1;
    let currentStreak = 1;
    let updatedCoins = 0;

    await db.runTransaction(async (transaction) => {
      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists) {
        throw new Error("User record does not exist.");
      }

      const userData = userSnap.data();
      const lastClaimTime = userData.lastDailyClaimTime || 0;
      currentStreak = userData.dailyStreakDay || 1;

      // Convert timestamp to days since epoch in Indian Standard Time (IST)
      const getISTDaysSinceEpoch = (timestamp) => {
        if (!timestamp) return 0;
        // Shift UTC timestamp to IST Time (UTC + 5:30)
        const istTime = Number(timestamp) + (5.5 * 60 * 60 * 1000);
        // Days since epoch (1 day = 86400000 milliseconds)
        return Math.floor(istTime / (24 * 60 * 60 * 1000));
      };

      const now = Date.now();
      const lastClaimDays = getISTDaysSinceEpoch(lastClaimTime);
      const nowDays = getISTDaysSinceEpoch(now);

      const isSameDay = lastClaimTime !== 0 && (lastClaimDays === nowDays);

      if (isSameDay) {
        throw new Error("Daily reward already claimed today! Come back tomorrow.");
      }

      // If missed claim for more than 1 Indian Calendar day, reset streak back to 1
      if (lastClaimTime > 0 && nowDays > lastClaimDays + 1) {
        currentStreak = 1;
      }

      // Determine coins
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

      // Next streak day
      nextStreak = currentStreak >= 7 ? 1 : currentStreak + 1;

      // Update user doc with new coins, streak day, last claim time
      transaction.update(userRef, {
        coins: updatedCoins,
        dailyStreakDay: nextStreak,
        lastDailyClaimTime: now
      });

      // Write immutable transaction record
      const dailyTxRef = db.collection("transactions").doc(`DAILY_CLAIM_${uid}_${now}`);
      transaction.set(dailyTxRef, {
        uid: uid,
        type: "EARN",
        title: `Daily Login Reward (Day ${currentStreak})`,
        details: `Claimed login bonus of +${coinsToReward} Coins!`,
        coinsAmount: coinsToReward,
        status: "SUCCESS",
        timestamp: now
      });
    });

    return res.status(200).json({
      success: true,
      coins: coinsToReward,
      newCoins: updatedCoins,
      streakDay: nextStreak,
      lastClaimTime: Date.now(),
      message: `Successfully claimed Day ${currentStreak} Daily Reward of +${coinsToReward} Coins!`
    });

  } catch (err) {
    console.error("Error claiming daily login coins:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
};
