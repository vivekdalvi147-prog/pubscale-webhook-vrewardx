const admin = require('firebase-admin');

// Initialize Firebase Admin SDK
let db = null;
let firebaseInitialized = false;
let firebaseStatus = "Not Initialized";

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
    firebaseStatus = `Connected successfully to firestore project: '${projectId}'`;
  } else {
    firebaseStatus = "Passive Mode (Logging Only). Configure FIREBASE credentials in Vercel to credit real coins.";
  }
} catch (e) {
  firebaseStatus = `Firebase initialization error: ${e.message}`;
  console.error("Firebase Admin init error:", e);
}

function getDashboardHtml(envDomain, logs, firebaseActive, firebaseMsg) {
  const logsRows = logs.length === 0 
    ? `<tr><td colspan="6" style="text-align: center; color: #8b949e; padding: 20px;">Waiting for test callbacks from PubScale dashboard...</td></tr>`
    : logs.map(item => `
      <tr>
        <td>${item.timestamp}</td>
        <td><code>${item.user_id}</code></td>
        <td><strong style="color: #79c0ff;">+${item.value} Coins</strong></td>
        <td><code style="font-size: 0.85em;">${item.token}</code></td>
        <td>
          ${item.verified 
            ? `<span class="success-text">✓ Verified Signature</span><br><small style="color: #8b949e; font-size: 0.85em;">Formula: ${item.formula}</small>` 
            : `<span class="error-text">✗ Verification Mismatch</span><br>`
          }
        </td>
        <td>
          ${item.verified 
            ? (item.db_success 
                ? `<span class="success-text">✓ Real Value Credited</span>` 
                : `<span class="error-text">✗ Failed db update</span>`
              ) + `<br><small style="color: #8b949e; font-size: 0.85em;">${item.db_msg}</small>`
            : `<span style="color: #8b949e;">Blocked</span>`
          }
        </td>
      </tr>
    `).join('');

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>vRewardX S2S Webhook Panel</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background-color: #0d1117;
            color: #c9d1d9;
            margin: 0;
            padding: 20px;
            display: flex;
            flex-direction: column;
            align-items: center;
        }
        .container {
            max-width: 950px;
            width: 100%;
            background-color: #161b22;
            border-radius: 12px;
            padding: 30px;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
            border: 1px solid #30363d;
        }
        h1 {
            color: #58a6ff;
            margin-top: 0;
            border-bottom: 2px solid #21262d;
            padding-bottom: 12px;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .status-badge {
            display: inline-block;
            background-color: #238636;
            color: white;
            padding: 6px 12px;
            border-radius: 20px;
            font-size: 0.85em;
            font-weight: bold;
            margin-bottom: 20px;
            margin-right: 10px;
        }
        .firebase-active {
            background-color: #238636;
        }
        .firebase-inactive {
            background-color: #d29922;
        }
        .card {
            background-color: #21262d;
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
            border: 1px solid #30363d;
        }
        .card-title {
            font-size: 1.15em;
            font-weight: bold;
            color: #58a6ff;
            margin-top: 0;
            margin-bottom: 15px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        code {
            font-family: 'Courier New', Courier, monospace;
            background-color: #0d1117;
            padding: 4px 8px;
            border-radius: 4px;
            color: #ff7b72;
            font-size: 1.05em;
            word-break: break-all;
        }
        .copied-hint {
            color: #3fb950;
            font-size: 0.85em;
            margin-left: 10px;
            display: none;
        }
        .copy-btn {
            background-color: #21262d;
            border: 1px solid #30363d;
            color: #c9d1d9;
            padding: 4px 8px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.85em;
            transition: 0.2s;
        }
        .copy-btn:hover {
            background-color: #30363d;
            border-color: #8b949e;
        }
        .log-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 25px;
        }
        .log-table th, .log-table td {
            border: 1px solid #30363d;
            padding: 12px;
            text-align: left;
        }
        .log-table th {
            background-color: #161b22;
            color: #58a6ff;
        }
        .log-table tr:nth-child(even) {
            background-color: #161b22;
        }
        .log-table tr:hover {
            background-color: #21262d;
        }
        .success-text {
            color: #3fb950;
            font-weight: bold;
        }
        .error-text {
            color: #f85149;
            font-weight: bold;
        }
        .env-item {
            margin-bottom: 12px;
            padding-bottom: 12px;
            border-bottom: 1px dashed #30363d;
        }
        .env-name {
            font-weight: bold;
            color: #79c0ff;
        }
    </style>
    <script>
        function copyText(id, hintId) {
            var text = document.getElementById(id).innerText;
            navigator.clipboard.writeText(text);
            var hint = document.getElementById(hintId);
            hint.style.display = 'inline';
            setTimeout(function() {
                hint.style.display = 'none';
            }, 2000);
        }
    </script>
</head>
<body>
    <div class="container">
        <h1>vRewardX Webhook Console Node.js 👑</h1>
        
        <div>
            <span class="status-badge">● SERVER ONLINE (NODE.JS)</span>
            ${firebaseActive 
              ? `<span class="status-badge firebase-active">● FIREBASE FIRESTORE SYNC: CONNECTED</span>`
              : `<span class="status-badge firebase-inactive">● FIREBASE STATUS: PASSIVE (LOG ONLY)</span>`
            }
        </div>

        <p style="color: #8b949e; font-size: 0.95em; line-height: 1.5;">
            ${firebaseMsg}
        </p>

        <!-- SECURE S2S CONFIG CARD -->
        <div class="card">
            <div class="card-title">🔗 Enter this Callback URL in PubScale Dashboard</div>
            <p>Use the exact URL structure below in your PubScale Publisher Dashboard to send real payouts:</p>
            <div style="display: flex; align-items: center; gap: 10px; margin: 10px 0;">
                <code id="callback-url">https://${envDomain}/api/callback</code>
                <button class="copy-btn" onclick="copyText('callback-url', 'cb-hint')">Copy</button>
                <span id="cb-hint" class="copied-hint">Copied!</span>
            </div>
            <p style="font-size: 0.9em; color: #8b949e;">Select <strong>GET</strong> as request method inside the PubScale panel setup.</p>
        </div>

        <!-- ENV VARIABLE INSTRUCTIONS CARD -->
        <div class="card">
            <div class="card-title">🔒 Vercel Dashboard Environment Variables Config</div>
            <p>To avoid copy-paste JSON failures on Vercel, please add these environment variables individually inside your **Vercel Project Settings ➔ Environment Variables** page. <strong>Do not upload the service account file or paste full JSON as one key</strong>, use the separate keys below:</p>
            
            <div class="env-item">
                <div class="env-name">1. PUBSCALE_S2S_SECRET</div>
                <p style="margin: 4px 0; font-size: 0.9em; color: #8b949e;">Your S2S secret key from PubScale Dashboard (used to verify hashes securely and prevent fraud).</p>
            </div>

            <div class="env-item">
                <div class="env-name">2. FIREBASE_PROJECT_ID</div>
                <p style="margin: 4px 0; font-size: 0.9em; color: #8b949e;">Enter: <code>vrewardx</code></p>
            </div>

            <div class="env-item">
                <div class="env-name">3. FIREBASE_CLIENT_EMAIL</div>
                <p style="margin: 4px 0; font-size: 0.9em; color: #8b949e;">Enter: <code>firebase-adminsdk-fbsvc@vrewardx.iam.gserviceaccount.com</code></p>
            </div>

            <div class="env-item">
                <div class="env-name">4. FIREBASE_PRIVATE_KEY</div>
                <p style="margin: 4px 0; font-size: 0.9em; color: #8b949e;">Copy your entire private key starting from <code>-----BEGIN PRIVATE KEY-----</code> up to <code>-----END PRIVATE KEY-----</code> (including all lines, exact as provided by Firebase console).</p>
            </div>
        </div>

        <h2>Incoming Webhook Activity Logs (Live Stream)</h2>
        <p style="color: #8b949e; font-size: 0.9em;">Latest transactions requested from Pubscale are displayed below (sourced in real-time from Cloud Firestore):</p>
        <table class="log-table">
            <thead>
                <tr>
                    <th>Timestamp (UTC)</th>
                    <th>User ID (Uid)</th>
                    <th>Coins Credited</th>
                    <th>Token (Transaction)</th>
                    <th>Integrity Verification</th>
                    <th>Database Status</th>
                </tr>
            </thead>
            <tbody>
                ${logsRows}
            </tbody>
        </table>
    </div>
</body>
</html>
  `;
}

module.exports = async (req, res) => {
  const envDomain = req.headers['host'] || 'pubscale-webhook-vrewardx.vercel.app';
  
  let logs = [];
  if (firebaseInitialized && db) {
    try {
      const snapshot = await db.collection("pubscale_callbacks")
        .orderBy("created_at", "desc")
        .limit(15)
        .get();
        
      snapshot.forEach(doc => {
        const data = doc.data();
        logs.push({
          timestamp: data.timestamp || "N/A",
          user_id: data.user_id || "N/A",
          value: data.value || "0",
          token: data.token || "N/A",
          signature: data.signature || "N/A",
          verified: data.verified !== undefined ? data.verified : false,
          formula: data.formula || "Unknown",
          db_success: data.db_success !== undefined ? data.db_success : false,
          db_msg: data.db_msg || ""
        });
      });
    } catch (err) {
      console.error("Error reading logs from Firestore:", err);
    }
  }

  const html = getDashboardHtml(envDomain, logs, firebaseInitialized, firebaseStatus);
  res.setHeader('Content-Type', 'text/html');
  return res.status(200).send(html);
};
