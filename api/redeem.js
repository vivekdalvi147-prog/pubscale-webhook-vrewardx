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
  console.error("Firebase Admin initialization error on redeem:", e);
}

module.exports = async (req, res) => {
  // Enforce POST method for withdraw operations
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: "Method not allowed. Use POST request." });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: "Missing or invalid authorization token" });
  }

  const idToken = authHeader.split('Bearer ')[1];
  const { optionType, coinsNeeded, rewardDisplayValue, upiId } = req.body;

  if (!optionType || !coinsNeeded || !rewardDisplayValue) {
    return res.status(400).json({ success: false, error: "Missing required params: optionType, coinsNeeded, rewardDisplayValue" });
  }

  const coinsToDeduct = parseInt(coinsNeeded, 10);
  if (isNaN(coinsToDeduct) || coinsToDeduct <= 0) {
    return res.status(400).json({ success: false, error: "Coins needed must be a positive integer." });
  }

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

    const userRef = db.collection("users").doc(uid);

    // 2. Perform a secure atomicity database transaction to confirm balance and deduct coins
    const result = await db.runTransaction(async (transaction) => {
      const userDoc = await transaction.get(userRef);
      if (!userDoc.exists) {
        throw new Error("Your user account was not found in database.");
      }

      const userData = userDoc.data();
      if (userData.isBlocked) {
        throw new Error("This account has been permanently suspended for violating rules.");
      }

      const currentCoins = parseInt(userData.coins || 0, 10);

      // CRITICAL SERVER-SIDE BALANCE VALIDATION!
      if (currentCoins < coinsToDeduct) {
        throw new Error(`Insufficient coins. Your server balance: ${currentCoins}, requested deduction: ${coinsToDeduct}.`);
      }

      const updatedCoins = currentCoins - coinsToDeduct;
      const updatedLockedCoins = parseInt(userData.lockedCoins || 0, 10) + coinsToDeduct;

      transaction.update(userRef, {
        coins: updatedCoins,
        lockedCoins: updatedLockedCoins,
        upiId: upiId || userData.upiId || ""
      });

      return {
        previousCoins: currentCoins,
        newCoins: updatedCoins,
        lockedCoins: updatedLockedCoins
      };
    });

    // 3. Create a pending withdrawal transaction log securely on Firestore
    const currentTimestampMillis = Date.now();
    const txId = `${uid}_REDEEM_${currentTimestampMillis}`;
    
    let detailsMessage = "";
    if (optionType === "UPI") {
      detailsMessage = `Transferred to UPI ID: ${upiId}`;
    } else if (optionType === "PLAYSTORE") {
      detailsMessage = "Google Play Redeem Voucher issued instantly";
    } else {
      detailsMessage = "Amazon Pay Gift Card Voucher";
    }

    await db.collection("transactions").doc(txId).set({
      uid: uid,
      type: "REDEEM",
      title: `${rewardDisplayValue} Payout Request`,
      details: detailsMessage,
      coinsAmount: coinsToDeduct,
      status: "PENDING",
      timestamp: currentTimestampMillis
    });

    return res.status(200).json({
      success: true,
      uid: uid,
      previousCoins: result.previousCoins,
      newCoins: result.newCoins,
      coinsAmount: coinsToDeduct,
      message: `Redemption of ${rewardDisplayValue} has been verified and processed securely from server balances!`
    });

  } catch (error) {
    console.error("Redeem validation failed:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};
