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
  console.error("Firebase Admin initialization error on notification api:", e);
}

module.exports = async (req, res) => {
  // CORS configuration
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

  if (!firebaseInitialized || !db) {
    return res.status(503).json({ 
      success: false, 
      error: "Firebase Admin is not initialized. Please configure FIREBASE credentials on Vercel." 
    });
  }

  try {
    const { type, title, message, clickUrl, imageUrl, uid } = req.body;

    if (!title || !message) {
      return res.status(400).json({ success: false, error: "Title and message/body are required." });
    }

    const payload = {
      notification: {
        title: title,
        body: message
      },
      data: {
        clickUrl: clickUrl || "",
        imageUrl: imageUrl || ""
      }
    };

    // Add extra keys for backwards accessibility in backgrounds
    payload.data.title = title;
    payload.data.message = message;
    payload.data.body = message;

    const androidConfig = {
      priority: "high",
      notification: {
        channelId: "app_broadcast_notifications",
        sound: "default",
        defaultSound: true,
        notificationPriority: "PRIORITY_HIGH",
        visibility: "public"
      }
    };

    if (type === 'broadcast') {
      // 1. Send broadcast notification to the "broadcast" topic (scalable to millions of users)
      const broadcastPayload = {
        topic: 'broadcast',
        notification: payload.notification,
        data: payload.data,
        android: androidConfig
      };

      const response = await admin.messaging().send(broadcastPayload);
      
      // Also write in legacy config document for legacy list/history fallback purposes
      await db.collection("config").doc("broadcast").set({
        title: title,
        message: message,
        clickUrl: clickUrl || "",
        imageUrl: imageUrl || "",
        timestamp: Date.now()
      });

      return res.status(200).json({ 
        success: true, 
        messageId: response, 
        message: "Broadcast FCM notification dispatched successfully to all subscribers!" 
      });

    } else if (type === 'individual') {
      if (!uid) {
        return res.status(400).json({ success: false, error: "User ID (uid) is required for individual notifications." });
      }

      // Query the specific user
      const userRef = db.collection("users").doc(uid);
      const userSnap = await userRef.get();

      if (!userSnap.exists) {
        return res.status(404).json({ success: false, error: "User profile not found in database." });
      }

      const fcmToken = userSnap.data().fcmToken;
      if (!fcmToken) {
        return res.status(404).json({ success: false, error: "Target FCM token not found for this user." });
      }

      const userPayload = {
        token: fcmToken,
        notification: payload.notification,
        data: payload.data,
        android: androidConfig
      };

      const response = await admin.messaging().send(userPayload);
      return res.status(200).json({ 
        success: true, 
        messageId: response, 
        message: `FCM push notification sent to user ${userSnap.data().displayName || uid} successfully!` 
      });

    } else {
      return res.status(400).json({ success: false, error: "Invalid notification type. Choose 'broadcast' or 'individual'." });
    }

  } catch (err) {
    console.error("FCM dispatch error:", err);
    return res.status(500).json({ success: false, error: `Notification error: ${err.message}` });
  }
};
