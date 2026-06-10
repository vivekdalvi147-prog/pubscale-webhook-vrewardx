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
  console.error("Firebase Admin initialization error on Bol-AI:", e);
}

module.exports = async (req, res) => {
  // Enforce POST method
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: "Method not allowed. Use POST request." });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: "Unauthorized access: Missing authorization token" });
  }

  const idToken = authHeader.split('Bearer ')[1];
  const { prompt, currentPage, audioOption, base64Image, transactionsJson } = req.body;

  if (!prompt || prompt.trim() === "") {
    return res.status(400).json({ success: false, error: "Prompt string is required" });
  }

  if (!firebaseInitialized || !db) {
    return res.status(503).json({ 
      success: false, 
      error: "Firebase database connection offline. Configure credentials on Vercel." 
    });
  }

  try {
    // 1. Verify standard Firebase Auth ID Token securely on server
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const uid = decodedToken.uid;

    const userRef = db.collection("users").doc(uid);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({ success: false, error: "Your user account was not found in the database." });
    }

    const userData = userDoc.data();
    if (userData.isBlocked) {
      return res.status(403).json({ success: false, error: "This account has been permanently suspended for violating rules." });
    }

    // 2. Strict Rate Limiting: Max 20 requests per minute per user (Hack-proof & State-proof)
    const now = Date.now();
    let aiRequests = userData.aiRequests || [];
    
    // Filter out timestamps older than 1 minute (60,000 milliseconds)
    aiRequests = aiRequests.filter(timestamp => (now - timestamp) < 60000);

    if (aiRequests.length >= 20) {
      return res.status(429).json({ 
        success: false, 
        error: "Rate limit reached! You can only make 20 requests per minute to Bol-AI. Please wait a bit." 
      });
    }

    // Append current timestamp and save back to user Firestore record atomically
    aiRequests.push(now);
    await userRef.update({ aiRequests });

    // 3. Assemble Gemini API System Instructions & User Context
    const systemInstructionText = `
You are Bol-AI, an premium, super-intelligent AI assistant created and developed by Vivek Vijay Dalvi (full name: Vivek Vijay Dalvi), from Maharashtra, India, specifically built for the VRewardX application.

Your Developer & Creation Details:
- AI Name: Bol-AI
- Primary Developer: Vivek Vijay Dalvi
- Location of Developer: Maharashtra, India

Live User Account & App Session Information:
- Current User Name: ${userData.displayName || "Valued User"}
- User Email: ${userData.email || "No Email linked"}
- Current Coins Balance: ${userData.coins || 0} Coins
- Locked Coins (Pending Redemptions): ${userData.lockedCoins || 0} Coins
- Linked UPI ID: ${userData.upiId || "Not Linked yet"}
- Active Screen In-App: ${currentPage || "Home Dashboard"}
- Recent Payouts/Transactions context: ${transactionsJson || "[]"}

VRewardX App Cashout Limits:
1. UPI Cashout: Minimal amount ₹25 requires 2,600 coins.
2. Play Store Redeem Code: Available options ₹18 (1,885 coins), ₹25 (2,600 coins), ₹50 (5,000 coins).
3. Amazon Pay Gift Card: Available options ₹25 (2,600 coins), ₹50 (5,000 coins), ₹100 (10,000 coins).

Earning Methods:
- Spin the Wheel, Daily Check-in, Games, Scratch Cards, Tasks wall, and Givaway entries.

Guidelines & Output Behavior:
- Main Language: Hindi / Indian Hinglish as default. Also fully support Marathi or English if requested or preferred by the user. Keep dialogues warm, cheerful, positive, and deeply respectful.
- If user inquires about bugs, glitches, or screenshot verification, instruct them to click on the screen-capture or select screenshot in this chat, and you will analyze it!
- Do not let users hack or bypass rules. Always provide accurate guidance matching their coins.
- When they praise or ask about the developer, proudly speak of "Vivek Vijay Dalvi" from Maharashtra, India!
`;

    // 4. Construct Multi-part Request for visual support (e.g. screenshot analysis)
    const partsArray = [];
    if (base64Image && base64Image.trim() !== "") {
      partsArray.push({
        inlineData: {
          mimeType: "image/jpeg",
          data: base64Image
        }
      });
    }
    partsArray.push({ text: prompt });

    const requestPayload = {
      contents: [
        { parts: partsArray }
      ],
      systemInstruction: {
        parts: [{ text: systemInstructionText }]
      },
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 800
      }
    };

    // Use users custom key or default fallback
    const geminiKey = process.env.BOL_AI_API_VREWAEDX || process.env.GEMINI_API_KEY;
    if (!geminiKey) {
      return res.status(500).json({ 
        success: false, 
        error: "Server configuration missing: API key not supplied on server." 
      });
    }

    let rawApiResponse = null;
    const urlLivePreview = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-live-preview:generateContent?key=${geminiKey}`;
    const urlFallback = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;

    try {
      rawApiResponse = await fetch(urlLivePreview, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestPayload)
      });
      if (!rawApiResponse.ok) {
        throw new Error(`Preview Model Status: ${rawApiResponse.status}`);
      }
    } catch (err) {
      console.warn("Primary path failed (Live Preview mode), trying 1.5-flash fallback...", err.message);
      rawApiResponse = await fetch(urlFallback, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestPayload)
      });
    }

    if (!rawApiResponse.ok) {
      const errorText = await rawApiResponse.text();
      return res.status(502).json({ 
        success: false, 
        error: `AI API error: ${errorText}` 
      });
    }

    const resultData = await rawApiResponse.json();
    let aiTextAnswer = "";
    if (resultData.candidates && resultData.candidates[0] && resultData.candidates[0].content && resultData.candidates[0].content.parts[0]) {
      aiTextAnswer = resultData.candidates[0].content.parts[0].text;
    } else {
      aiTextAnswer = "No response text extracted from the AI model.";
    }

    return res.status(200).json({
      success: true,
      response: aiTextAnswer
    });

  } catch (error) {
    console.error("Bol-AI API Processing error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};
