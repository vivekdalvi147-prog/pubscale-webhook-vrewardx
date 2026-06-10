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
  console.error("Firebase Admin initialization error on AI endpoint:", e);
}

module.exports = async (req, res) => {
  // Only allow POST request
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: "Method not allowed. Use POST." });
  }

  // Validate Authorization Token
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: "Missing or invalid authorization token" });
  }

  const idToken = authHeader.split('Bearer ')[1];
  const { 
    message, 
    userName, 
    userCoins, 
    userCash, 
    withdrawalValue, 
    appLocation, 
    language, 
    voiceEnabled, 
    imageBase64 
  } = req.body;

  if (!message) {
    return res.status(400).json({ success: false, error: "Missing required parameter: message" });
  }

  if (!firebaseInitialized || !db) {
    return res.status(503).json({ 
      success: false, 
      error: "Firebase connection was offline. Configure credentials on Vercel." 
    });
  }

  try {
    // 1. SECURE TOKEN VERIFICATION (Hack protection)
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const uid = decodedToken.uid;

    const userRef = db.collection("users").doc(uid);
    const userSnapshot = await userRef.get();
    if (!userSnapshot.exists) {
      return res.status(404).json({ success: false, error: "Your user account was not found." });
    }

    const userData = userSnapshot.data();
    if (userData.isBlocked) {
      return res.status(403).json({ success: false, error: "This account is permanently suspended." });
    }

    // 2. SECURE FIRESTORE-BACKED RATE LIMITING (Max 20 requests per minute)
    const rateLimitDocRef = db.collection("users").doc(uid).collection("private").doc("ai_limit");
    const rateLimitSnapshot = await rateLimitDocRef.get();
    let timestamps = [];
    if (rateLimitSnapshot.exists) {
      timestamps = rateLimitSnapshot.data().timestamps || [];
    }
    
    const now = Date.now();
    // Keep requests from the last minute (60,000 ms)
    timestamps = timestamps.filter(t => t > now - 60000);

    if (timestamps.length >= 20) {
      return res.status(429).json({ 
        success: false, 
        error: "Rate limit exceeded! You are only allowed to send 20 requests per minute to BOL-AI." 
      });
    }

    // Register active request timestamp
    timestamps.push(now);
    await rateLimitDocRef.set({ timestamps });

    // 3. RETRIEVE BOL-AI API KEY FROM ENVIRONMENT
    const apiKey = process.env.BOL_AI_API_VREWAEDX;
    if (!apiKey) {
      return res.status(500).json({ 
        success: false, 
        error: "BOL_AI_API_VREWAEDX is not configured on server backend." 
      });
    }

    // Supported target language
    const currentLang = language || "hindi";

    // 4. CONSTRUCT SYSTEM CONTEXT & PROMPT (BOL-AI, developed by Vivek Vijay Dalvi)
    const systemPrompt = `You are 'BOL-AI', a cutting-edge real-time assistant developed exclusively by Vivek Vijay Dalvi (full name: Vivek Vijay Dalvi) from Maharashtra, India, for the 'vRewardX' application.

Current User & Session Context:
- Developer: Vivek Vijay Dalvi (India, Maharashtra)
- User Name: ${userName || "Valued User"}
- User Current Balance: ${userCoins || 0} Coins (Approx. Cash: ${userCash || "₹0"})
- Minimum App Withdrawal Constraint: ${withdrawalValue || "₹10 / ₹25"}
- Current Screen Area: ${appLocation || "Home Dashboard"}

How vRewardX Works:
1. Play & Earn: Users complete offers and games via PubScale Offerwall to earn coins.
2. Low Withdrawals: Users can withdraw their coins as real cash via UPI, Google Play Gift Vouchers, or Amazon Gift Cards (payouts start as low as ₹10 to ₹25).
3. Secure & Legit: It is a 100% secure earning platform.

General Rules:
- You must always respond in a concise, friendly, and helpful tone.
- Your primary language context is ${currentLang.toUpperCase()}. Always align your response tone to this language, but speak naturally.
- When explaining app features, guide the user about the PubScale Offerwall, active contests, earning pathways, or cashouts.
- State clearly that you are developed by Vivek Vijay Dalvi from Maharashtra, India.
- If an image is provided, inspect it (e.g. if the user says "what is this", "kaisa chalega" or uploaded a screenshot, help them debug it or explain what they see).`;

    // 5. STRUCTURE THE GEMINI MULTIMODAL payload
    const parts = [
      { text: systemPrompt },
      { text: `User query: ${message}` }
    ];

    if (imageBase64) {
      parts.push({
        inlineData: {
          mimeType: "image/jpeg",
          data: imageBase64
        }
      });
    }

    // Call Google Gemini API (Using 1.5-flash as the robust production engine, with search grounding)
    // We allow mapping to public v1beta endpoint.
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const payload = {
      contents: [
        {
          parts: parts
        }
      ],
      // NATIVE GOOGLE SEARCH GROUNDING
      tools: [
        {
          googleSearch: {}
        }
      ]
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gemini API calling error:", errText);
      return res.status(502).json({ success: false, error: "Failed to communicate with the core AI model." });
    }

    const resJson = await response.json();
    
    // Parse Gemini text response
    let botResponse = "I could not generate a response. Please try again.";
    try {
      if (resJson.candidates && resJson.candidates[0] && resJson.candidates[0].content) {
        botResponse = resJson.candidates[0].content.parts[0].text;
      }
    } catch (parseErr) {
      console.error("Failed to parse response structure:", parseErr);
    }

    // Detect if search queries were utilized by Gemini Search Grounding
    let searchQueryUsed = null;
    try {
      const searchMetadata = resJson.candidates?.[0]?.groundingMetadata;
      if (searchMetadata && searchMetadata.webSearchQueries && searchMetadata.webSearchQueries.length > 0) {
        searchQueryUsed = searchMetadata.webSearchQueries.join(", ");
      }
    } catch (err) {}

    return res.status(200).json({
      success: true,
      text: botResponse,
      searchQueryUsed: searchQueryUsed
    });

  } catch (error) {
    console.error("AI secure execution exception:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};
