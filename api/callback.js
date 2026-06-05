const admin = require('firebase-admin');
const crypto = require('crypto');

// 1. Firebase Admin SDK Initialize करें
if (admin.apps.length === 0) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  } catch (error) {
    console.error("Firebase Admin initialization failed:", error);
  }
}

const db = admin.firestore();

// S2S Callback Endpoint
module.exports = async (req, res) => {
  // केवल GET/POST अनुरोधों को अनुमति दें
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).send('HTTP Method Not Allowed');
  }

  // PubScale query strings से पैरामीटर निकालें
  const { user_id, value, token, signature } = req.query;

  // 2. Parameters Validation
  if (!user_id || !value || !token || !signature) {
    console.error("S2S Alert: Missing required parameters in request.", req.query);
    return res.status(400).send('HTTP 400 Bad Request: Missing required parameters');
  }

  const coinsValue = parseInt(value, 10);
  if (isNaN(coinsValue) || coinsValue <= 0) {
    console.error("S2S Alert: Invalid coin value:", value);
    return res.status(400).send('HTTP 400 Bad Request: Invalid reward value');
  }

  // 3. PubScale MD5 Signature Verifier
  // S2S Security Token को Vercel Env (PUBSCALE_SECRET_KEY) से लाएं
  const s2sSecret = process.env.PUBSCALE_SECRET_KEY || "your_pubscale_secret_here";

  // PubScale की अलग-अलग hashing combinations को वेरिफ़ाई करने की सुरक्षित टेक्निक:
  // Combination A: user_id + value + token + secret
  const dataStringA = `${user_id}${value}${token}${s2sSecret}`;
  const generatedSignatureA = crypto.createHash('md5').update(dataStringA).digest('hex');

  // Combination B: value + user_id + token + secret (अलग SDK वर्शन्स के लिए)
  const dataStringB = `${value}${user_id}${token}${s2sSecret}`;
  const generatedSignatureB = crypto.createHash('md5').update(dataStringB).digest('hex');

  const signatureMatches = 
    (signature.toLowerCase() === generatedSignatureA) || 
    (signature.toLowerCase() === generatedSignatureB);

  if (!signatureMatches) {
    console.error(`S2S Security Mismatch: Signature calculation failed! Received: ${signature}, Expected: ${generatedSignatureA}`);
    return res.status(403).send('HTTP 403 Forbidden: Signature Checksum Verification Failed');
  }

  try {
    // 4. Duplicate Check (Deduplication / Replay Protection)
    // token का उपयोग यूनीक ट्रांज़ैक्शन ID के रूप में करें
    const txDocRef = db.collection('transactions').doc(`pubscale_${token}`);
    const txSnapshot = await txDocRef.get();

    if (txSnapshot.exists) {
      console.log(`S2S Alert: Duplicate Request. Transaction ${token} already processed.`);
      // PubScale को 200 OK वापस भेजें ताकि वे दोबारा रिक्वेस्ट भेजना बंद करें (मगर कॉइन्स फिर से नहीं मिलेंगे!)
      return res.status(200).send('HTTP 200 OK: Already Processed');
    }

    // 5. User Verify करें
    const userDocRef = db.collection('users').doc(user_id);
    const userSnapshot = await userDocRef.get();

    if (!userSnapshot.exists) {
      console.error(`S2S Alert: User with ID ${user_id} not found in database.`);
      return res.status(404).send('HTTP 404 Not Found: User Account does not exist');
    }

    // 6. DB Transaction: Coins Increment और Transaction Logging
    await db.runTransaction(async (transaction) => {
      // यूज़र डेटा पढ़ें
      const userDoc = await transaction.get(userDocRef);
      const currentCoins = userDoc.data().coins || 0;
      const newCoins = currentCoins + coinsValue;

      // Coins बढ़ाएं
      transaction.update(userDocRef, { coins: newCoins });

      // Transaction History Log बनाएं
      const currentTimestamp = Date.now();
      const transactionPayload = {
        uid: user_id,
        type: "EARN",
        title: "PubScale Offerwall Reward",
        details: `Approved (Offer Token: ${token})`,
        coinsAmount: coinsValue,
        status: "SUCCESS",
        timestamp: currentTimestamp
      };

      transaction.set(txDocRef, transactionPayload);
    });

    console.log(`S2S Success: Successfully credited ${coinsValue} coins to user ${user_id}`);
    return res.status(200).send('HTTP 200 OK: Reward credited successfully');

  } catch (error) {
    console.error("S2S Error processing transaction in Firestore:", error);
    return res.status(500).send('HTTP 500 Internal Server Error');
  }
};
