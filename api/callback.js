const admin = require('firebase-admin');
const crypto = require('crypto');

// सुरक्षितपणे फायरबेस इनिशियलाइज करणारा हेल्पिंग फंक्शन
function getFirestoreDB() {
    if (admin.apps.length === 0) {
        // पद्धत A: संपूर्ण सर्व्हिस अकाउंट JSON स्ट्रिंगवरून पार्स करणे
        if (process.env.FIREBASE_SERVICE_ACCOUNT) {
            try {
                const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
                admin.initializeApp({
                    credential: admin.credential.cert(serviceAccount)
                });
                console.log("Firebase initialized successfully via FIREBASE_SERVICE_ACCOUNT.");
            } catch (err) {
                console.error("FIREBASE_SERVICE_ACCOUNT JSON Parse Failed:", err.message);
            }
        }

        // पद्धत B: वैयक्तिक Env Variables वरून इनिशियलाइज करणे (पर्यायी)
        if (admin.apps.length === 0 && process.env.FIREBASE_PRIVATE_KEY) {
            try {
                admin.initializeApp({
                    credential: admin.credential.cert({
                        projectId: process.env.FIREBASE_PROJECT_ID || "vrewardx",
                        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
                    })
                });
                console.log("Firebase initialized successfully via individual keys.");
            } catch (err) {
                console.error("Firebase Individual keys initialization failed:", err.message);
            }
        }

        // पद्धत C: डिफॉल्ट क्रेडेंशियल्स (स्थानिक किंवा ऑटोमेटेड)
        if (admin.apps.length === 0) {
            try {
                admin.initializeApp();
                console.log("Firebase initialized using default application credentials.");
            } catch (err) {
                console.error("Default Firebase initialization also failed:", err.message);
            }
        }
    }

    if (admin.apps.length === 0) {
        throw new Error("CRITICAL: Firebase Admin SDK could not be initialized. Please check your Vercel Environment Variables configured.");
    }

    return admin.firestore();
}

module.exports = async (req, res) => {
    // केवळ GET आणि POST पॅरामीटर्सना परवानगी देणे
    if (req.method !== 'GET' && req.method !== 'POST') {
        return res.status(405).send('HTTP Method Not Allowed');
    }

    try {
        const db = getFirestoreDB();
        
        // PubScale पोस्टबॅक पॅरामीटर्स मिळवा
        const { user_id, value, token, signature } = req.query;

        console.log(`Received Postback -> User: ${user_id}, Coins: ${value}, Token/ClickID: ${token}, Signature: ${signature}`);

        // १. पॅरामीटर्स व्हेरिफिकेशन
        if (!user_id || !value || !token || !signature) {
            return res.status(400).send('HTTP 400 Bad Request: Missing user_id, value, token, or signature');
        }

        const coinsValue = parseInt(value, 10);
        if (isNaN(coinsValue) || coinsValue <= 0) {
            return res.status(400).send('HTTP 400 Bad Request: Invalid coins value');
        }

        // २. सिक्युरिटी सिग्नेचर व्हेरिफिकेशन
        const s2sSecret = process.env.PUBSCALE_SECRET_KEY || process.env.PUBSCALE_SECURITY_TOKEN || "PUBSCALE_SECRET_KEY";

        // कॉम्बिनेशन A: user_id + value + token + secret
        const dataStringA = `${user_id}${value}${token}${s2sSecret}`;
        const generatedSignatureA = crypto.createHash('md5').update(dataStringA).digest('hex');

        // कॉम्बिनेशन B: value + user_id + token + secret
        const dataStringB = `${value}${user_id}${token}${s2sSecret}`;
        const generatedSignatureB = crypto.createHash('md5').update(dataStringB).digest('hex');

        const signatureMatches = 
            (signature.toLowerCase() === generatedSignatureA) || 
            (signature.toLowerCase() === generatedSignatureB);

        if (!signatureMatches) {
            console.error(`Signature mismatch! Expected A: ${generatedSignatureA}, Received: ${signature}`);
            return res.status(403).send('HTTP 403 Forbidden: Signature verification failed.');
        }

        // ३. डुप्लिकेट रिप्ले प्रोटेक्शन (Prevent double spending)
        const txDocRef = db.collection('transactions').doc(`pubscale_${token}`);
        const txSnapshot = await txDocRef.get();

        if (txSnapshot.exists) {
            console.log(`Transaction ${token} already processed before.`);
            return res.status(200).send('HTTP 200 OK: Already Processed Successfully');
        }

        // ४. युझर डॉक्युमेंट चेक करणे आणि नसल्यास नवीन तयार करणे (On-the-fly provision)
        const userDocRef = db.collection('users').doc(user_id);
        const userSnapshot = await userDocRef.get();

        // ५. ट्रान्झॅक्शन चालवून कॉइन्स वाढवा आणि लॉग नोंदवा
        await db.runTransaction(async (transaction) => {
            let currentCoins = 0;
            if (userSnapshot.exists) {
                const userDoc = await transaction.get(userDocRef);
                currentCoins = userDoc.data().coins || 0;
            } else {
                console.log(`User ${user_id} does not exist in Firestore yet. Provisioning user document automatically for smooth live testing.`);
            }

            const newCoins = currentCoins + coinsValue;

            // युझरचे कॉइन्स अपडेट / सेट करा
            transaction.set(userDocRef, { 
                coins: newCoins,
                uid: user_id,
                updatedAt: Date.now()
            }, { merge: true });

            // ट्रान्झॅक्शन हिस्ट्री लॉग सुरक्षित ठेवा
            const currentTimestamp = Date.now();
            const transactionPayload = {
                uid: user_id,
                type: "EARN",
                title: "PubScale Offerwall Reward",
                details: `Approved (Offer Token/Click: ${token})`,
                coinsAmount: coinsValue,
                status: "SUCCESS",
                timestamp: currentTimestamp
            };

            transaction.set(txDocRef, transactionPayload);
        });

        console.log(`Successfully credited ${coinsValue} coins to user: ${user_id}`);
        return res.status(200).send('HTTP 200 OK: Reward credited successfully to the wallet');

    } catch (error) {
        console.error("Callback Execution Failure:", error);
        return res.status(500).send(`HTTP 500 Internal Error: ${error.message}`);
    }
};
