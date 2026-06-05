const admin = require("firebase-admin");
const crypto = require("crypto");

// 1. Firebase Admin SDK Initialization
// Vercel Settings' Environment Variables में FIREBASE_SERVICE_ACCOUNT (JSON format) डालें
if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  } catch (error) {
    console.error("Firebase admin initialization failed:", error);
  }
}

const db = admin.firestore();

// 2. Pubscale Secret Key (यह आपको Pubscale dashboard पर S2S config में मिलेगी)
// इसे Vercel environment variables में "PUBSCALE_SECRET_KEY" नाम से सेव करें
const PUBSCALE_S2S_SECRET = process.env.PUBSCALE_SECRET_KEY || "☠️";

module.exports = async (req, res) => {
  // केवल GET/POST Requests allow करें (S2S triggers standard GET/POST query params)
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use GET or POST." });
  }

  // Parameters extract करना (Works for both query string and request body)
  const params = { ...req.query, ...req.body };
  
  const value = params.value;       // कमाई गई coins की संख्या (जैसे 1500)
  const userId = params.user_id;     // Android App से भेजी गई user list UID
  const token = params.token;       // Unique click transaction tracking ID (Replay check के लिए)
  const signature = params.signature; // PubScale का secure cryptographic hash signature

  console.log(`[POSTBACK] Request received. user_id: ${userId}, token: ${token}, coins: ${value}`);

  // 3. Simple Missing Values Checking
  if (!userId || !value || !token || !signature) {
    return res.status(400).json({ error: "Missing required S2S callback parameters." });
  }

  try {
    // 4. Secure Handshake Cryptographic Checksum Verification
    // S2S signature formula according to Pubscale protocol specifications:
    // md5_signature = md5(user_id + token + value + secret)
    const rawString = `${userId}${token}${value}${PUBSCALE_S2S_SECRET}`;
    const calculatedSignature = crypto
      .createHash("md5")
      .update(rawString)
      .digest("hex");

    if (signature.toLowerCase() !== calculatedSignature.toLowerCase()) {
      console.warn(`[SECURITY] Signature verification failed! Expected: ${calculatedSignature}, Got: ${signature}`);
      return res.status(403).json({ error: "Internal S2S Signature verification failed. Unauthorized payload." });
    }

    // 5. Check if Token (Transaction ID) limit was already processed (Replay Attack Prevention)
    const txRef = db.collection("transactions").doc(`${userId}_${token}`);
    const txSnap = await txRef.get();

    if (txSnap.exists) {
      console.warn(`[DUPLICATION ERROR] Transaction token ${token} was already processed. Blocked duplicate coin injection.`);
      return res.status(409).json({ error: "Postback conflicted. This transaction has already been logged." });
    }

    // 6. Atomic Transaction to update User Coins and create Transaction Log safely
    const userRef = db.collection("users").document(userId);

    await db.runTransaction(async (transaction) => {
      const userSnap = await transaction.get(userRef);

      if (!userSnap.exists) {
        throw new Error(`User account matching ID ${userId} does not exist in database.`);
      }

      const currentCoins = userSnap.data().coins || 0;
      const coinsToAdd = parseInt(value, 10);
      const updatedCoins = currentCoins + coinsToAdd;

      // Update User Coins count securely in Firestore
      transaction.update(userRef, { 
        coins: updatedCoins 
      });

      // Write transaction success logs in database
      transaction.set(txRef, {
        uid: userId,
        type: "EARN",
        title: "PubScale Offerwall Awarded",
        details: `Secured via Vercel Postback Webhook (Token: ${token})`,
        coinsAmount: coinsToAdd,
        status: "SUCCESS",
        timestamp: Date.now()
      });
    });

    console.log(`[SUCCESS] atomic coins upgrade done. User ${userId} gained +${value} coins! New Balance: ${updatedCoins}`);
    
    // Pubscale expected response message formats
    return res.status(200).json({ 
      success: true, 
      message: "Pubscale Postback Callback successfully processed. Handshake validated!" 
    });

  } catch (error) {
    console.error(`[EXCEPTION] S2S runtime server error:`, error.message);
    return res.status(500).json({ error: error.message });
  }
};
