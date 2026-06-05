const admin = require('firebase-admin');
const crypto = require('crypto');

// 1. Firebase Admin SDK Initialization
if (!admin.apps.length) {
    try {
        admin.initializeApp({
            credential: admin.credential.cert({
                projectId: process.env.FIREBASE_PROJECT_ID || "vrewardx",
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                // Automatically replaces literal newlines safely
                privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined,
            })
        });
        console.log("Firebase Admin Initialized successfully!");
    } catch (error) {
        console.error("Firebase Initialization Error:", error);
    }
}

const db = admin.firestore();

module.exports = async (req, res) => {
    // PubScale sends GET requests for callbacks
    if (req.method !== 'GET') {
        return res.status(405).json({ error: "Method Not Allowed. Use GET." });
    }

    try {
        // Query Parameters which PubScale sends automatically
        const { user_id, value, token, signature } = req.query;

        console.log(`Received S2S Callback: User: ${user_id}, Coins: ${value}, Token: ${token}, Signature: ${signature}`);

        if (!user_id || !value || !token || !signature) {
            return res.status(400).json({ error: "Missing required query parameters: user_id, value, token, or signature." });
        }

        const coinReward = parseInt(value, 10);
        if (isNaN(coinReward) || coinReward <= 0) {
            return res.status(400).json({ error: "Invalid coin balance value." });
        }

        // 2. CRYPTOGRAPHIC SIGNATURE VERIFICATION (Security Check)
        const securitySecret = process.env.PUBSCALE_SECURITY_TOKEN; 
        
        if (securitySecret) {
            // PubScale generates signature by sorting parameters alphabetially or concating: user_id + value + token + secret
            // Let's construct locally generated signature to verify integrity
            const rawString = `${user_id}${value}${token}${securitySecret}`;
            const generatedSignature = crypto.createHash('md5').update(rawString).digest('hex');

            if (generatedSignature !== signature) {
                console.error(`Security alert! Signature mismatch. Expected: ${generatedSignature}, Received: ${signature}`);
                return res.status(403).json({ error: "Signature verification failed. Untrusted S2S payload source." });
            }
            console.log("Signature Verified Successfuly! Payload is authentic.");
        } else {
            console.warn("PUBSCALE_SECURITY_TOKEN is missing in Vercel. Skipping security hash verification.");
        }

        // 3. SECURE TRANSACTION IN FIRESTORE (Atomicity)
        const userRef = db.collection('users').document(user_id);
        const txRef = db.collection('transactions').document(token); // Use token as unique click_id to prevent double spending

        await db.runTransaction(async (transaction) => {
            const txDoc = await transaction.get(txRef);
            
            // Prevent duplicate coin injection (Idempotency check)
            if (txDoc.exists) {
                throw new Error("Transaction Token has already been processed previously.");
            }

            const userDoc = await transaction.get(userRef);
            
            let currentCoins = 0;
            if (userDoc.exists) {
                currentCoins = userDoc.data().coins || 0;
            }

            const updatedCoins = currentCoins + coinReward;

            // Update user balance
            transaction.set(userRef, {
                coins: updatedCoins
            }, { merge: true });

            // Record transaction detail log
            transaction.set(txRef, {
                uid: user_id,
                type: "EARN",
                title: "Offerwall Completion",
                details: `Earned securely from PubScale Offer Completion (Ref: ${token})`,
                coinsAmount: coinReward,
                status: "SUCCESS",
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
        });

        console.log(`Successfully credited ${coinReward} coins to User: ${user_id}`);

        // PubScale expects a JSON success response
        return res.status(200).json({ 
            status: "success", 
            message: `User ${user_id} rewarded with ${coinReward} coins successfully.` 
        });

    } catch (error) {
        console.error("Callback Execution Failed:", error.message);
        return res.status(500).json({ status: "error", message: error.message });
    }
};
