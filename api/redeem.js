const { admin, db, rtdb, firebaseInitialized, syncSet, syncUpdate } = require('./firebase');

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

  // Strictly enforce predefined package configurations on the server to prevent client-side/vulnerability exploits!
  let isValidPackage = false;
  if (optionType === "UPI" && (coinsToDeduct === 2600 || coinsToDeduct === 5000)) {
    isValidPackage = true;
  } else if (optionType === "PLAYSTORE" && (coinsToDeduct === 1885 || coinsToDeduct === 2600 || coinsToDeduct === 5000)) {
    isValidPackage = true;
  } else if (optionType === "AMAZON" && (coinsToDeduct === 1300 || coinsToDeduct === 5000)) {
    isValidPackage = true;
  }

  if (!isValidPackage) {
    return res.status(400).json({ 
      success: false, 
      error: "Security Check failed: Invalid payout option or unauthorized coin cost manipulation. Operation blocked." 
    });
  }

  if (!firebaseInitialized || !rtdb) {
    return res.status(503).json({ 
      success: false, 
      error: "Firebase database connection was offline. Configure FIREBASE credentials on Vercel." 
    });
  }

  try {
    // 1. Verify standard Firebase Auth ID Token securely on the server side
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const uid = decodedToken.uid;

    // Read user from RTDB
    const userSnapshot = await rtdb.ref(`users/${uid}`).get();
    if (!userSnapshot.exists()) {
      return res.status(404).json({ success: false, error: "Your user account was not found in database." });
    }

    const userData = userSnapshot.val();
    if (userData.isBlocked) {
      return res.status(403).json({ success: false, error: "This account has been permanently suspended for violating rules." });
    }

    const currentCoins = parseInt(userData.coins || 0, 10);

    // CRITICAL SERVER-SIDE BALANCE VALIDATION!
    if (currentCoins < coinsToDeduct) {
      return res.status(400).json({ success: false, error: `Insufficient coins. Your server balance: ${currentCoins}, requested deduction: ${coinsToDeduct}.` });
    }

    const updatedCoins = currentCoins - coinsToDeduct;
    const updatedLockedCoins = parseInt(userData.lockedCoins || 0, 10) + coinsToDeduct;
    const finalUpi = upiId || userData.upiId || "";

    // Save update securely inside RTDB
    await rtdb.ref(`users/${uid}`).update({
      coins: updatedCoins,
      lockedCoins: updatedLockedCoins,
      upiId: finalUpi
    });

    const result = {
      previousCoins: currentCoins,
      newCoins: updatedCoins,
      lockedCoins: updatedLockedCoins,
      finalUpi: finalUpi
    };

    // 3. Create a pending withdrawal transaction log securely on Firestore and RTDB
    const currentTimestampMillis = Date.now();
    const txId = `${uid}_REDEEM_${currentTimestampMillis}`;
    
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
      title: `${rewardDisplayValue} Payout Request`,
      details: detailsMessage,
      coinsAmount: coinsToDeduct,
      status: "PENDING",
      timestamp: currentTimestampMillis
    };

    // Use lockstep sync API
    await syncSet("transactions", txId, txObj);

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
