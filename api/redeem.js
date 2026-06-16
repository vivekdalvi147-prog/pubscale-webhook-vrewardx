const { admin, db, rtdb, firebaseInitialized, syncSet, syncUpdate } = require('./firebase');
const crypto = require('crypto');

// Memory rate limit cache
const rateLimitCache = new Map();

function isRateLimited(ip, endpoint, limit = 5, windowMs = 60000) {
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
  // Enforce POST method for withdraw operations
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: "Method not allowed. Use POST request." });
  }

  const clientIp = getClientIp(req);

  // Rate Limiting Check
  if (isRateLimited(clientIp, "redeem", 5, 60000)) {
    return res.status(429).json({ success: false, error: "Rate limit exceeded. Please wait a moment." });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: "Missing or invalid authorization token" });
  }

  const idToken = authHeader.split('Bearer ')[1];
  const { optionType, coinsNeeded, upiId } = req.body;

  if (!optionType || !coinsNeeded) {
    return res.status(400).json({ success: false, error: "Missing required params: optionType, coinsNeeded" });
  }

  const coinsToDeduct = parseInt(coinsNeeded, 10);
  if (isNaN(coinsToDeduct) || coinsToDeduct <= 0) {
    return res.status(400).json({ success: false, error: "Coins needed must be a positive integer." });
  }

  // 1. Strictly enforce predefined configurations & server-controlled display values (NEVER trust client display values)
  let serverDisplayValue = "";
  if (optionType === "UPI") {
    if (coinsToDeduct === 2600) serverDisplayValue = "UPI ₹200";
    else if (coinsToDeduct === 5000) serverDisplayValue = "UPI ₹400";
  } else if (optionType === "PLAYSTORE") {
    if (coinsToDeduct === 1885) serverDisplayValue = "Google Play ₹150";
    else if (coinsToDeduct === 2600) serverDisplayValue = "Google Play ₹200";
    else if (coinsToDeduct === 5000) serverDisplayValue = "Google Play ₹400";
  } else if (optionType === "AMAZON") {
    if (coinsToDeduct === 1300) serverDisplayValue = "Amazon Pay ₹100";
    else if (coinsToDeduct === 5000) serverDisplayValue = "Amazon Pay ₹400";
  }

  if (!serverDisplayValue) {
    return res.status(400).json({ 
      success: false, 
      error: "Security Check failed: Invalid payout option or unauthorized coin cost manipulation. Operation blocked." 
    });
  }

  // 2. UPI Format validation server-side
  if (optionType === "UPI") {
    if (!upiId || typeof upiId !== 'string') {
      return res.status(400).json({ success: false, error: "UPI ID is required for UPI redemption." });
    }
    const upiRegex = /^[\w\.\-]+@[\w\.\-]+$/;
    if (!upiRegex.test(upiId.trim())) {
      return res.status(400).json({ success: false, error: "Invalid UPI ID format. Standard bank handles only (e.g. example@bank)." });
    }
  }

  if (!firebaseInitialized || !rtdb) {
    return res.status(503).json({ 
      success: false, 
      error: "Database offline. Please try again later." 
    });
  }

  // App Check Verification (Optional check if header present)
  const appCheckToken = req.headers['x-firebase-appcheck'];
  if (appCheckToken) {
    try {
      await admin.appCheck().verifyToken(appCheckToken);
    } catch (e) {
      return res.status(403).json({ success: false, error: "Security check failed: App Check verification rejected." });
    }
  }

  try {
    // 3. Verify standard Firebase Auth ID Token securely on server-side WITH revoked token checks
    const decodedToken = await admin.auth().verifyIdToken(idToken, true);
    const uid = decodedToken.uid;

    const now = Date.now();
    let transactionResultError = null;
    let previousCoins = 0;
    let newCoins = 0;
    let lockedCoins = 0;
    let finalUpi = "";

    // 4. Run Transaction on user balance to prevent race conditions (double spending via multiple simultaneous threads)
    const transactionResult = await rtdb.ref(`users/${uid}`).transaction((user) => {
      if (user === null) {
        return user; // wait for SDK data load
      }

      if (user.isBlocked) {
        transactionResultError = "This account has been permanently suspended for violating rules.";
        return; // Aborts transaction
      }

      const currentCoins = parseInt(user.coins || 0, 10);

      // CRITICAL SERVER-SIDE BALANCE VALIDATION!
      if (currentCoins < coinsToDeduct) {
        transactionResultError = `Insufficient coins. Your server balance: ${currentCoins}, requested: ${coinsToDeduct}.`;
        return; // Aborts transaction
      }

      // ENFORCE 1-HOUR COOLDOWN LIMITATION
      const lastWithdrawal = parseInt(user.lastWithdrawalTimestamp || 0, 10);
      const oneHourMs = 3600000;
      if (now - lastWithdrawal < oneHourMs) {
        const minutesLeft = Math.ceil((oneHourMs - (now - lastWithdrawal)) / 60000);
        transactionResultError = `Rate Limit: You can request a withdrawal only once per 1 hour. Please wait ${minutesLeft} minute(s).`;
        return; // Aborts transaction
      }

      user.coins = currentCoins - coinsToDeduct;
      user.lockedCoins = parseInt(user.lockedCoins || 0, 10) + coinsToDeduct;
      user.upiId = upiId || user.upiId || "";
      user.lastWithdrawalTimestamp = now;

      previousCoins = currentCoins;
      newCoins = user.coins;
      lockedCoins = user.lockedCoins;
      finalUpi = user.upiId;

      return user;
    });

    if (transactionResultError) {
      return res.status(400).json({ success: false, error: transactionResultError });
    }

    if (!transactionResult.committed) {
      return res.status(500).json({ success: false, error: "The request was busy. Please try again." });
    }

    const result = {
      previousCoins: previousCoins,
      newCoins: newCoins,
      lockedCoins: lockedCoins,
      finalUpi: finalUpi
    };

    // 5. Create a pending withdrawal transaction log with collision-free ID suffix
    const currentTimestampMillis = Date.now();
    const randomSuffix = crypto.randomBytes(4).toString('hex');
    const txId = `${uid}_REDEEM_${currentTimestampMillis}_${randomSuffix}`;
    
    let detailsMessage = "";
    if (optionType === "UPI") {
      detailsMessage = `Transferred to UPI ID: ${result.finalUpi}`;
    } else if (optionType === "PLAYSTORE") {
      detailsMessage = "Google Play Redeem Voucher issued instantly";
    } else {
      detailsMessage = "Amazon Pay Gift Card Voucher";
    }

    const txObj = {
      uid: uid,
      type: "REDEEM",
      title: `${serverDisplayValue} Payout Request`,
      details: detailsMessage,
      coinsAmount: coinsToDeduct,
      status: "PENDING",
      timestamp: currentTimestampMillis
    };

    // 6. REDEEM ROLLBACK LOGIC: If writing the transaction fails, refund the user atomically!
    try {
      await syncSet("transactions", txId, txObj);
    } catch (saveError) {
      console.error("Failed to write redeem transaction log, initiating safe rollback refund:", saveError);
      try {
        await rtdb.ref(`users/${uid}`).transaction((user) => {
          if (user) {
            user.coins = parseInt(user.coins || 0, 10) + coinsToDeduct;
            user.lockedCoins = Math.max(0, parseInt(user.lockedCoins || 0, 10) - coinsToDeduct);
            if (user.lastWithdrawalTimestamp === now) {
              user.lastWithdrawalTimestamp = 0; // reset
            }
          }
          return user;
        });
      } catch (rollbackError) {
        console.error("CRITICAL: Rollback failed as well:", rollbackError);
      }
      return res.status(500).json({ success: false, error: "Failed to log transaction. Your spent coins have been refunded." });
    }

    return res.status(200).json({
      success: true,
      uid: uid,
      previousCoins: result.previousCoins,
      newCoins: result.newCoins,
      coinsAmount: coinsToDeduct,
      message: `Redemption of ${serverDisplayValue} has been verified and processed securely from server balances!`
    });

  } catch (error) {
    console.error("Redeem validation failed:", error);
    return res.status(500).json({ success: false, error: "An internal server error occurred while processing redemption." });
  }
};
