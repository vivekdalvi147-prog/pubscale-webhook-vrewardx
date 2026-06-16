const { admin, db, rtdb, firebaseInitialized, syncSet, syncUpdate } = require('./firebase');
const crypto = require('crypto');

module.exports = async (req, res) => {
  // CORS configuration
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

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: "Method not allowed. Use POST request." });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: "Missing or invalid authorization context." });
  }

  if (!firebaseInitialized || !db || !rtdb) {
    return res.status(503).json({
      success: false,
      error: "Firebase administration handshake was offline. Please configure FIREBASE credentials in Vercel settings."
    });
  }

  const appCheckToken = req.headers['x-firebase-appcheck'];
  if (appCheckToken) {
    try {
      await admin.appCheck().verifyToken(appCheckToken);
    } catch (e) {
      return res.status(403).json({ success: false, error: "Security check failed: App Check rejected." });
    }
  }

  const idToken = authHeader.split('Bearer ')[1];
  const { action } = req.body;

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken, true);
    const uid = decodedToken.uid;

    // 1. Check if the user has completed at least 1 Pubscale offer to combat multi-account setups
    let hasCompletedOffer = false;

    // Load user first in RTDB to check inline flag which is super fast and requires no index
    const userSnapshot = await rtdb.ref(`users/${uid}`).get();
    let userDataVal = {};
    if (userSnapshot.exists()) {
      userDataVal = userSnapshot.val() || {};
      if (userDataVal.hasCompletedOffer === true || (userDataVal.completedPubscaleOffers || 0) > 0 || (userDataVal.completedCount || 0) > 0) {
        hasCompletedOffer = true;
      }
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
      return res.status(403).json({
        success: false,
        error: "Your game play status is locked! You must complete at least 1 PubScale Offer first!"
      });
    }

    if (action === "deduct_entry") {
      const stake = parseInt(req.body.stake, 10);
      if (stake !== 100 && stake !== 500) {
        return res.status(400).json({ success: false, error: "Invalid stake amount selected." });
      }

      let updatedCoins = 0;
      let transactionError = null;

      // ATOMIC TRANSACTION FOR DEDUCTING ENTRY
      const txResult = await rtdb.ref(`users/${uid}`).transaction((userObj) => {
        if (userObj === null) return userObj;
        if (userObj.isBlocked === true) {
          transactionError = "This profile is permanently blocked.";
          return;
        }
        const currentCoins = parseInt(userObj.coins || 0, 10);
        if (currentCoins < stake) {
          transactionError = "Insufficient coins to join this arena.";
          return;
        }
        userObj.coins = currentCoins - stake;
        updatedCoins = userObj.coins;
        return userObj;
      });

      if (transactionError) {
        return res.status(400).json({ success: false, error: transactionError });
      }

      if (!txResult.committed) {
        return res.status(500).json({ success: false, error: "The deduct transaction was busy, please retrying." });
      }

      // Save Spend Transaction with unique suffix
      const currentTimestampMillis = Date.now();
      const randomSuffix = crypto.randomBytes(4).toString('hex');
      const txId = `${uid}_GAME_ENTRY_${currentTimestampMillis}_${randomSuffix}`;
      const txObj = {
        uid: uid,
        type: "SPEND",
        title: `TicTacToe Arena Entry: ${stake} Coins`,
        details: "Matchmaking search coins committed safely to lobby server.",
        coinsAmount: -stake,
        status: "SUCCESS",
        timestamp: currentTimestampMillis
      };
      await syncSet("transactions", txId, txObj);

      return res.status(200).json({
        success: true,
        newCoins: updatedCoins,
        message: "Coins deducted. Looking for match..."
      });
    }

    else if (action === "refund_cancel") {
      const stake = parseInt(req.body.stake, 10);
      if (stake !== 100 && stake !== 500) {
        return res.status(400).json({ success: false, error: "Invalid stake amount." });
      }

      const queueRef = rtdb.ref(`matchmaking/${stake}/${uid}`);
      const queueSnap = await queueRef.get();
      if (!queueSnap.exists()) {
        return res.status(400).json({ success: false, error: "No active search queue found for your profile at this stake." });
      }

      const queueData = queueSnap.val();
      if (queueData.matchedWith && queueData.matchedWith !== "") {
        return res.status(400).json({ success: false, error: "Too late! You have already been matched with an opponent." });
      }

      // Delete matchmaking queue node
      await queueRef.remove();

      let updatedCoins = 0;
      
      // ATOMIC TRANSACTION FOR CANCELLATION REFUND
      const txResult = await rtdb.ref(`users/${uid}`).transaction((userObj) => {
        if (userObj === null) return userObj;
        const currentCoins = parseInt(userObj.coins || 0, 10);
        userObj.coins = currentCoins + stake;
        updatedCoins = userObj.coins;
        return userObj;
      });

      if (!txResult.committed) {
        return res.status(500).json({ success: false, error: "Failed to refund lobby coins safely. Please contact support." });
      }

      // Save Refund/Cancellation Transaction with unique suffix
      const currentTimestampMillis = Date.now();
      const randomSuffix = crypto.randomBytes(4).toString('hex');
      const txId = `${uid}_GAME_CANCEL_${currentTimestampMillis}_${randomSuffix}`;
      const txObj = {
        uid: uid,
        type: "EARN",
        title: `Matchmaking Cancelled: Refund`,
        details: `Entry fee of ${stake} Coins returned on search cancellation.`,
        coinsAmount: stake,
        status: "SUCCESS",
        timestamp: currentTimestampMillis
      };
      await syncSet("transactions", txId, txObj);

      return res.status(200).json({
        success: true,
        newCoins: updatedCoins,
        message: "Matchmaking search cancelled. Coins refunded successfully."
      });
    }

    else if (action === "reward_win") {
      const { gameId, winUid } = req.body;
      if (!gameId || !winUid) {
        return res.status(400).json({ success: false, error: "Missing matchmaking game identity parameters." });
      }

      if (winUid !== uid) {
        return res.status(403).json({ success: false, error: "Cannot claim victory rewards for another player." });
      }

      // Fetch from Realtime Database to assert victory
      const gameRef = rtdb.ref(`games/${gameId}`);
      const gameSnap = await gameRef.get();
      if (!gameSnap.exists()) {
        return res.status(404).json({ success: false, error: "Game session has expired or was not found." });
      }

      const gameData = gameSnap.val();
      if (gameData.status === "payout_completed") {
        return res.status(400).json({ success: false, error: "Victory reward has already been claimed for this session." });
      }

      const playerX = gameData.playerX;
      const playerO = gameData.playerO;
      const winnerSymbol = gameData.winner; // "X" or "O"

      if (winnerSymbol !== "X" && winnerSymbol !== "O") {
        return res.status(400).json({ success: false, error: "No winner has been declared on the server node yet." });
      }

      const declaredWinnerUid = (winnerSymbol === "X") ? playerX : playerO;
      if (declaredWinnerUid !== uid) {
        return res.status(403).json({ success: false, error: "Client-claimed winner does not match real game states." });
      }

      const stake = parseInt(gameData.stake, 10);
      let prizeAmount = 0;
      if (stake === 100) prizeAmount = 200;
      else if (stake === 500) prizeAmount = 980;
      else {
        return res.status(400).json({ success: false, error: "Unrecognized game state stake amount." });
      }

      // Mark the game node as payout completed immediately to avoid double spend
      await gameRef.update({ status: "payout_completed" });

      let updatedCoins = 0;

      // ATOMIC TRANSACTION FOR WIN REWARD
      const txResult = await rtdb.ref(`users/${uid}`).transaction((userObj) => {
        if (userObj === null) return userObj;
        const currentCoins = parseInt(userObj.coins || 0, 10);
        userObj.coins = currentCoins + prizeAmount;
        updatedCoins = userObj.coins;
        return userObj;
      });

      if (!txResult.committed) {
        return res.status(500).json({ success: false, error: "Victory coins payout failed securely. Contact support." });
      }

      // Write transaction with unique suffix
      const currentTimestampMillis = Date.now();
      const randomSuffix = crypto.randomBytes(4).toString('hex');
      const txId = `${uid}_GAME_WIN_${currentTimestampMillis}_${randomSuffix}`;
      const txObj = {
        uid: uid,
        type: "EARN",
        title: `TicTacToe Arena Victory: +${prizeAmount} Coins`,
        details: `Won a Match against ${uid === playerX ? (gameData.playerOName || "opponent") : (gameData.playerXName || "opponent")}.`,
        coinsAmount: prizeAmount,
        status: "SUCCESS",
        timestamp: currentTimestampMillis
      };
      await syncSet("transactions", txId, txObj);

      // Notify other players
      const broadcastObj = {
        title: "🎉 TicTacToe Victory Declared!",
        message: `${uid === playerX ? gameData.playerXName : gameData.playerOName} won the arena match of ${stake} Coins stake!`,
        timestamp: currentTimestampMillis
      };
      await syncSet("config", "broadcast", broadcastObj);

      return res.status(200).json({
        success: true,
        prize: prizeAmount,
        newCoins: updatedCoins,
        message: `Congratulations! Successfully credited +${prizeAmount} reward coins to your wallet.`
      });
    }

    else if (action === "refund_draw") {
      const { gameId } = req.body;
      if (!gameId) {
        return res.status(400).json({ success: false, error: "Missing game identifier." });
      }

      const gameRef = rtdb.ref(`games/${gameId}`);
      const gameSnap = await gameRef.get();
      if (!gameSnap.exists()) {
        return res.status(404).json({ success: false, error: "Game session not found." });
      }

      const gameData = gameSnap.val();
      const playerX = gameData.playerX;
      const playerO = gameData.playerO;

      if (uid !== playerX && uid !== playerO) {
        return res.status(403).json({ success: false, error: "You are not a participant in this game session." });
      }

      const stake = parseInt(gameData.stake, 10);
      const isPlayerX = (uid === playerX);

      // Verify that both players voted for refund or the game is drawing / abandoned
      const refundClaimedField = isPlayerX ? "refundXClaimed" : "refundOClaimed";
      if (gameData[refundClaimedField] === true) {
        return res.status(400).json({ success: false, error: "You have already claimed refund for this session." });
      }

      const refundRequestedField = isPlayerX ? "refundX" : "refundO";
      const otherRefundRequestedField = isPlayerX ? "refundO" : "refundX";

      // Allow refund if game was ended on Draw and BOTH users requested refund, OR if status is abandoned
      const isAbandoned = gameData.status === "abandoned";
      const isDrawRefundMutuallyAgreed = (gameData[refundRequestedField] === true && gameData[otherRefundRequestedField] === true);

      if (!isAbandoned && !isDrawRefundMutuallyAgreed) {
        return res.status(400).json({
          success: false,
          error: "Refund request is pending. Opponent also has to agree to Refund/End match."
        });
      }

      // Mark this player's portion of the refund as claimed
      const updatePayload = {};
      updatePayload[refundClaimedField] = true;
      
      // If both are now refunded, status changes to "refunded"
      const currentClaimedX = isPlayerX ? true : (gameData.refundXClaimed || false);
      const currentClaimedO = !isPlayerX ? true : (gameData.refundOClaimed || false);
      if (currentClaimedX && currentClaimedO) {
        updatePayload["status"] = "refunded";
      }
      await gameRef.update(updatePayload);

      let updatedCoins = 0;

      // ATOMIC TRANSACTION FOR REFUND DRAW
      const txResult = await rtdb.ref(`users/${uid}`).transaction((userObj) => {
        if (userObj === null) return userObj;
        const currentCoins = parseInt(userObj.coins || 0, 10);
        userObj.coins = currentCoins + stake;
        updatedCoins = userObj.coins;
        return userObj;
      });

      if (!txResult.committed) {
        return res.status(500).json({ success: false, error: "Failed to credit refund coins. Please request support." });
      }

      // Write refund transaction with unique suffix
      const currentTimestampMillis = Date.now();
      const randomSuffix = crypto.randomBytes(4).toString('hex');
      const txId = `${uid}_GAME_REFUND_${currentTimestampMillis}_${randomSuffix}`;
      const txObj = {
        uid: uid,
        type: "EARN",
        title: `TicTacToe Match Refund: +${stake} Coins`,
        details: `Refunded stake coins for match session: ${gameId}.`,
        coinsAmount: stake,
        status: "SUCCESS",
        timestamp: currentTimestampMillis
      };
      await syncSet("transactions", txId, txObj);

      return res.status(200).json({
        success: true,
        refundAmount: stake,
        newCoins: updatedCoins,
        message: `Successfully refunded entry fee of +${stake} Coins to your wallet.`
      });
    }

    else {
      return res.status(400).json({ success: false, error: "Unknown game request action." });
    }

  } catch (error) {
    console.error("Game secure transition failed:", error);
    return res.status(500).json({ success: false, error: "An internal server error occurred while processing game session." });
  }
};
