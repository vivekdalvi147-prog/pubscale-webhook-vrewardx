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

function getDashboardHtml(envDomain, logs, users, transactions, firebaseActive, firebaseMsg) {
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

  const usersRows = users.length === 0
    ? `<tr><td colspan="5" style="text-align: center; color: #8b949e; padding: 20px;">No registered users synchronized yet...</td></tr>`
    : users.map(item => `
      <tr>
        <td><strong style="color: #ffffff;">${item.displayName}</strong></td>
        <td><code>${item.uid}</code></td>
        <td><span style="color: #8b949e;">${item.email}</span></td>
        <td><strong style="color: #58a6ff;">${item.coins} Coins</strong></td>
        <td><code style="font-size: 0.85em; color: #ff7b72;">${item.deviceId}</code></td>
      </tr>
    `).join('');

  const transactionsRows = transactions.length === 0
    ? `<tr><td colspan="6" style="text-align: center; color: #8b949e; padding: 20px;">No S2S transaction logs found in database...</td></tr>`
    : transactions.map(item => {
        const formattedDate = new Date(item.timestamp).toLocaleString();
        const badgeColor = item.type === "REDEEM" ? "color: #f85149;" : "color: #3fb950;";
        return `
      <tr>
        <td>${formattedDate}</td>
        <td><code>${item.uid}</code></td>
        <td><strong style="${badgeColor}">${item.type}</strong></td>
        <td>
          <div style="font-weight: bold; color: #ffffff;">${item.title}</div>
          <small style="color: var(--text-secondary); font-size: 0.85em;">${item.details}</small>
        </td>
        <td><strong style="${badgeColor}">${item.type === "REDEEM" ? "-" : "+"}${item.coinsAmount} Coins</strong></td>
        <td>
          ${item.status === "SUCCESS" 
            ? `<span class="success-text" style="font-size: 0.9em; font-weight: bold;">✓ APPROVED</span>`
            : item.status === "PENDING"
              ? `<span style="color: #d29922; font-size: 0.9em; font-weight: bold;">⏳ PENDING</span>`
              : `<span class="error-text" style="font-size: 0.9em; font-weight: bold;">✗ REJECTED</span>`
          }
        </td>
      </tr>
        `;
      }).join('');

  const totalRegisteredUsers = users.length;
  const pendingRedemptions = transactions.filter(t => t.type === "REDEEM" && t.status === "PENDING").length;
  const totalCoinsInCirculation = users.reduce((acc, curr) => acc + (curr.coins || 0), 0);

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>vRewardX S2S Webhook Panel | Made by Vivek Dalvi</title>
    
    <!-- Firebase Legacy/Compat SDKs (Best for HTML Template script tags) -->
    <script src="https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/10.8.0/firebase-auth-compat.js"></script>

    <style>
        :root {
            --bg-color: #0b0f17;
            --card-bg: #161b22;
            --card-border: #30363d;
            --primary-blue: #58a6ff;
            --primary-glow: rgba(88, 166, 255, 0.15);
            --text-main: #c9d1d9;
            --text-secondary: #8b949e;
            --success-color: #238636;
            --danger-color: #f85149;
            --font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif;
        }

        body {
            font-family: var(--font-family);
            background-color: var(--bg-color);
            color: var(--text-main);
            margin: 0;
            padding: 0;
            display: flex;
            flex-direction: column;
            align-items: center;
            min-height: 100vh;
        }

        /* LOGIN CONTAINER */
        .login-screen {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            width: 100%;
            padding: 20px;
            box-sizing: border-box;
        }

        .login-card {
            background-color: var(--card-bg);
            border: 1px solid var(--card-border);
            border-radius: 16px;
            padding: 40px;
            max-width: 420px;
            width: 100%;
            text-align: center;
            box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
            transition: transform 0.3s ease;
        }

        .login-card:hover {
            transform: translateY(-5px);
            box-shadow: 0 16px 45px var(--primary-glow);
        }

        .login-logo {
            width: 100px;
            height: 100px;
            border-radius: 50%;
            object-fit: cover;
            border: 3px solid var(--primary-blue);
            margin-bottom: 20px;
            box-shadow: 0 0 15px var(--primary-glow);
        }

        .login-card h2 {
            margin: 10px 0;
            color: #ffffff;
            font-size: 1.8em;
        }

        .login-card p {
            color: var(--text-secondary);
            font-size: 0.95em;
            margin-bottom: 30px;
        }

        .google-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            background-color: #ffffff;
            color: #1f2328;
            border: none;
            padding: 12px 24px;
            font-size: 1em;
            font-weight: 600;
            border-radius: 8px;
            cursor: pointer;
            width: 100%;
            transition: background-color 0.2s, transform 0.1s;
            gap: 12px;
        }

        .google-btn:hover {
            background-color: #f6f8fa;
            transform: scale(1.02);
        }

        .google-btn img {
            width: 20px;
            height: 20px;
        }

        /* MAIN DASHBOARD CONTAINER */
        .dashboard-container {
            display: none; /* Controlled via JS Auth */
            max-width: 1000px;
            width: 100%;
            padding: 20px;
            box-sizing: border-box;
            margin-top: 20px;
        }

        /* HEADER & USER BAR */
        .navbar {
            background-color: var(--card-bg);
            border: 1px solid var(--card-border);
            border-radius: 12px;
            padding: 15px 25px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 25px;
            flex-wrap: wrap;
            gap: 15px;
        }

        .brand-logo-area {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .brand-logo-img {
            width: 50px;
            height: 50px;
            border-radius: 50%;
            border: 2px solid var(--primary-blue);
            object-fit: cover;
        }

        .brand-title-wrap h1 {
            font-size: 1.3em;
            margin: 0;
            color: #ffffff;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .developer-badge {
            font-size: 0.75em;
            color: var(--primary-blue);
            font-weight: normal;
        }

        .user-profile {
            display: flex;
            align-items: center;
            gap: 12px;
            background-color: #0d1117;
            padding: 6px 12px;
            border-radius: 30px;
            border: 1px solid var(--card-border);
        }

        .user-avatar {
            width: 32px;
            height: 32px;
            border-radius: 50%;
            object-fit: cover;
        }

        .user-info {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
        }

        .user-name {
            font-size: 0.85em;
            font-weight: 600;
            color: #ffffff;
        }

        .logout-btn {
            background-color: transparent;
            border: 1px solid var(--danger-color);
            color: var(--danger-color);
            padding: 4px 10px;
            border-radius: 6px;
            font-size: 0.75em;
            cursor: pointer;
            font-weight: bold;
            transition: all 0.2s;
        }

        .logout-btn:hover {
            background-color: var(--danger-color);
            color: #ffffff;
        }

        /* STATUS BADGES & STATS ROW */
        .status-container {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            margin-bottom: 20px;
        }

        .status-badge {
            background-color: var(--card-bg);
            border: 1px solid var(--card-border);
            color: var(--text-main);
            padding: 8px 16px;
            border-radius: 20px;
            font-size: 0.85em;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .status-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            display: inline-block;
        }

        .dot-green { background-color: #3fb950; box-shadow: 0 0 8px #3fb950; }
        .dot-yellow { background-color: #d29922; box-shadow: 0 0 8px #d29922; }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
            gap: 15px;
            margin-bottom: 25px;
        }

        .stat-card {
            background-color: var(--card-bg);
            border: 1px solid var(--card-border);
            border-radius: 12px;
            padding: 20px;
            text-align: center;
        }

        .stat-value {
            font-size: 1.8em;
            font-weight: bold;
            color: var(--primary-blue);
            margin-bottom: 5px;
        }

        .stat-label {
            font-size: 0.85em;
            color: var(--text-secondary);
        }

        /* CALLBACK & CARD SECTIONS */
        .card {
            background-color: var(--card-bg);
            border-radius: 12px;
            padding: 24px;
            margin: 20px 0;
            border: 1px solid var(--card-border);
            box-shadow: 0 4px 20px rgba(0,0,0,0.15);
        }

        .card-title {
            font-size: 1.15em;
            font-weight: bold;
            color: var(--primary-blue);
            margin-top: 0;
            margin-bottom: 15px;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        code {
            font-family: 'Courier New', Courier, monospace;
            background-color: #0d1117;
            padding: 6px 12px;
            border-radius: 6px;
            color: #ff7b72;
            font-size: 1.05em;
            word-break: break-all;
            border: 1px solid #21262d;
            flex-grow: 1;
        }

        .copied-hint {
            color: #3fb950;
            font-size: 0.85em;
            margin-left: 10px;
            display: none;
        }

        .copy-btn {
            background-color: #21262d;
            border: 1px solid var(--card-border);
            color: var(--text-main);
            padding: 8px 16px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.9em;
            transition: 0.2s;
        }

        .copy-btn:hover {
            background-color: #30363d;
            border-color: #8b949e;
        }

        /* TABS STYLING */
        .tab-container {
            display: flex;
            gap: 10px;
            margin-top: 30px;
            margin-bottom: 20px;
            border-bottom: 1px solid var(--card-border);
            padding-bottom: 10px;
            overflow-x: auto;
        }

        .tab-btn {
            background-color: transparent;
            border: 1px solid transparent;
            color: var(--text-secondary);
            padding: 10px 20px;
            border-radius: 8px;
            font-size: 0.95em;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            white-space: nowrap;
        }

        .tab-btn:hover {
            color: #ffffff;
            background-color: #1f242d;
        }

        .tab-btn.active {
            color: var(--primary-blue);
            background-color: #1f242d;
            border-color: var(--primary-blue);
            box-shadow: 0 0 10px var(--primary-glow);
        }

        .tab-content {
            display: none;
        }

        .tab-content.active {
            display: block;
        }

        /* LOGS TABLE CSS */
        .table-responsive {
            overflow-x: auto;
            border-radius: 12px;
            border: 1px solid var(--card-border);
            background-color: var(--card-bg);
        }

        .log-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.9em;
        }

        .log-table th, .log-table td {
            padding: 14px 16px;
            text-align: left;
            border-bottom: 1px solid var(--card-border);
        }

        .log-table th {
            background-color: #0d1117;
            color: var(--primary-blue);
            font-weight: 600;
        }

        .log-table tr:hover {
            background-color: #1a202c;
        }

        .success-text {
            color: #3fb950;
            font-weight: bold;
        }

        .error-text {
            color: var(--danger-color);
            font-weight: bold;
        }

        /* FOOTER */
        footer {
            margin-top: 40px;
            margin-bottom: 20px;
            text-align: center;
            color: var(--text-secondary);
            font-size: 0.85em;
        }

        footer a {
            color: var(--primary-blue);
            text-decoration: none;
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

        function switchTab(tabId) {
            // Hide all tabs
            const contents = document.querySelectorAll(".tab-content");
            contents.forEach(el => el.classList.remove("active"));
            
            const buttons = document.querySelectorAll(".tab-btn");
            buttons.forEach(el => el.classList.remove("active"));
            
            // Show target
            document.getElementById(tabId).classList.add("active");
            
            // Activate button styling
            event.currentTarget.classList.add("active");
        }
    </script>
</head>
<body>

    <!-- 1. GOOGLE LOGIN SCREEN -->
    <div id="login-container" class="login-screen">
        <div class="login-card">
            <img class="login-logo" src="https://i.ibb.co/TDMwv5QD/Generated-Image-June052026-10-45-AM.jpg" alt="vRewardX Logo">
            <h2>vRewardX S2S Console</h2>
            <p>Sign in with your Google account to access webhook configurations and live streams.</p>
            
            <button class="google-btn" onclick="googleLogin()">
                <img src="https://lh3.googleusercontent.com/COxitqgJr1sICZ9m4_SxCxOfmI2AH0m99FmOfCH_Cj5ywC2WIB6ODb9_7X9S4Z2S-g7=" alt="Google Icon">
                Sign In with Google
            </button>
            
            <div style="margin-top: 25px; font-size: 0.8em; color: var(--text-secondary);">
                Made with ❤️ by Vivek Dalvi
            </div>
        </div>
    </div>

    <!-- 2. AUTHENTICATED DASHBOARD PANEL -->
    <div id="dashboard-container" class="dashboard-container">
        
        <!-- NAVBAR -->
        <div class="navbar">
            <div class="brand-logo-area">
                <img class="brand-logo-img" src="https://i.ibb.co/TDMwv5QD/Generated-Image-June052026-10-45-AM.jpg" alt="vRewardX Logo">
                <div class="brand-title-wrap">
                    <h1>vRewardX Webhook Console <span class="developer-badge">v2.1</span></h1>
                    <span style="font-size: 0.8em; color: var(--text-secondary);">made by vivek dalvi</span>
                </div>
            </div>

            <!-- Profile Widget -->
            <div class="user-profile">
                <img id="user-avatar" class="user-avatar" src="" alt="User Avatar">
                <div class="user-info">
                    <span id="user-name" class="user-name">Loading...</span>
                    <button class="logout-btn" onclick="logout()">Logout</button>
                </div>
            </div>
        </div>

        <!-- STATUS BAR -->
        <div class="status-container">
            <div class="status-badge">
                <span class="status-dot dot-green"></span>
                <span>SERVER ONLINE (NODE.JS)</span>
            </div>
            ${firebaseActive 
              ? `<div class="status-badge"><span class="status-dot dot-green"></span><span>FIREBASE SYNC: ACTIVE</span></div>`
              : `<div class="status-badge"><span class="status-dot dot-yellow"></span><span>FIREBASE: PASSIVE LOG ONLY</span></div>`
            }
        </div>

        <!-- STATS / METRICS VIEW (LOOKS ADVANCED) -->
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-value">${totalRegisteredUsers}</div>
                <div class="stat-label">Verified Users Sync</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" style="color: #79c0ff;">${totalCoinsInCirculation}</div>
                <div class="stat-label">Total Coins in Circulation</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" style="color: #ff7b72;">${pendingRedemptions}</div>
                <div class="stat-label">Pending Payout Claims</div>
            </div>
        </div>

        <p style="color: var(--text-secondary); font-size: 0.95em; line-height: 1.5; margin-bottom: 25px;">
            ${firebaseMsg}
        </p>

        <!-- SECURE S2S APIs DEPLOYED INFO CARD -->
        <div class="card">
            <div class="card-title">🛡️ Secure S2S Auth Verification Hook APIs Active</div>
            <p style="color: var(--text-secondary); font-size: 0.9em; margin-bottom: 12px;">This backend server implements strict, server-side validation to safeguard against database tampering or hacked app attempts:</p>
            <div style="font-size: 0.85em; display: flex; flex-direction: column; gap: 12px;">
                <div style="border-bottom: 1px dashed var(--card-border); padding-bottom: 8px;">
                    <strong style="color: var(--primary-blue)">1. Google Profile Signups Welcomer (POST METHOD)</strong><br>
                    <code style="display: block; margin-top: 4px; padding: 4px 8px;">https://${envDomain}/api/signup</code>
                    <span style="color: var(--text-secondary); display: block; margin-top: 4px;">Decrypts and verifies standard Google Auth ID Tokens. Hardcodes initial welcome gifts strictly to 50 coins securely on the database layer.</span>
                </div>
                <div>
                    <strong style="color: var(--primary-blue)">2. Atomic Payout/Redeem Controller (POST METHOD)</strong><br>
                    <code style="display: block; margin-top: 4px; padding: 4px 8px;">https://${envDomain}/api/redeem</code>
                    <span style="color: var(--text-secondary); display: block; margin-top: 4px;">Executes strict Firestore transaction routines, guaranteeing user balances really possess the required coins before deducting them.</span>
                </div>
            </div>
        </div>

        <!-- SECURE S2S CONFIG CARD -->
        <div class="card">
            <div class="card-title">🔗 Enter this Callback URL in PubScale Dashboard</div>
            <p style="color: var(--text-secondary); font-size: 0.9em; margin-bottom: 15px;">Use the exact URL structure below in your PubScale Publisher Dashboard to send real payouts:</p>
            <div style="display: flex; align-items: center; gap: 10px; margin: 15px 0; flex-wrap: wrap;">
                <code id="callback-url">https://${envDomain}/api/callback</code>
                <button class="copy-btn" onclick="copyText('callback-url', 'cb-hint')">Copy</button>
                <span id="cb-hint" class="copied-hint">Copied!</span>
            </div>
            <p style="font-size: 0.85em; color: var(--text-secondary); margin-bottom: 0;">⚡ Select <strong>GET</strong> as request method inside the PubScale panel setup.</p>
        </div>

        <!-- TAB MENU SYSTEM -->
        <div class="tab-container">
            <button class="tab-btn active" onclick="switchTab('pubscale-logs')">🛡️ Pubscale hook webhooks</button>
            <button class="tab-btn" onclick="switchTab('app-users')">👥 Registered App Users (${totalRegisteredUsers})</button>
            <button class="tab-btn" onclick="switchTab('s2s-transactions')">📜 Secure S2S Activity Logs (${transactions.length})</button>
        </div>

        <!-- TAB CONTENT: PUBSCALE WEBHOOKS -->
        <div id="pubscale-logs" class="tab-content active">
            <h2>Incoming Webhook Activity Logs (Live Stream)</h2>
            <p style="color: var(--text-secondary); font-size: 0.9em; margin-bottom: 15px;">Latest postbacks synchronized in real-time from Cloud Firestore:</p>
            <div class="table-responsive">
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
        </div>

        <!-- TAB CONTENT: APPLICATION USERS -->
        <div id="app-users" class="tab-content">
            <h2>Authorized App User Base</h2>
            <p style="color: var(--text-secondary); font-size: 0.9em; margin-bottom: 15px;">Secure real-time ledger of synchronized dynamic user balances:</p>
            <div class="table-responsive">
                <table class="log-table">
                    <thead>
                        <tr>
                            <th>User Name</th>
                            <th>User ID (Uid)</th>
                            <th>Email Address</th>
                            <th>Coin Balance</th>
                            <th>Registered Device ID</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${usersRows}
                    </tbody>
                </table>
            </div>
        </div>

        <!-- TAB CONTENT: S2S TRANSACTION HISTORY -->
        <div id="s2s-transactions" class="tab-content">
            <h2>Server-to-Server Transaction Streams</h2>
            <p style="color: var(--text-secondary); font-size: 0.9em; margin-bottom: 15px;">System transactions ledger tracking Registration Welcome Bonuses (50 Coins) & secure Cashouts:</p>
            <div class="table-responsive">
                <table class="log-table">
                    <thead>
                        <tr>
                            <th>Date / Timestamp</th>
                            <th>User ID (Uid)</th>
                            <th>Transaction Type</th>
                            <th>Activity Details</th>
                            <th>Coins Transferred</th>
                            <th>Server Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${transactionsRows}
                    </tbody>
                </table>
            </div>
        </div>

        <footer>
            <p>&copy; 2026 vRewardX Console. All rights reserved. Created with dedication by <a href="#">Vivek Dalvi</a>.</p>
        </footer>
    </div>

    <!-- FIREBASE INITIALIZATION & AUTHENTICATION LOGIC -->
    <script>
        // Your Provided Firebase Configuration
        const firebaseConfig = {
            apiKey: "AIzaSyBCROZHQcXGxZCupI0dg0Ehx2_i0SKINls",
            authDomain: "vrewardx.firebaseapp.com",
            projectId: "vrewardx",
            storageBucket: "vrewardx.firebasestorage.app",
            messagingSenderId: "446047163907",
            appId: "1:446047163907:web:9aa45be59b0476699c2036",
            measurementId: "G-GBVZZ517HF"
        };

        // Initialize Firebase
        firebase.initializeApp(firebaseConfig);
        const auth = firebase.auth();

        // Watch Authentication State
        auth.onAuthStateChanged((user) => {
            const loginSection = document.getElementById("login-container");
            const dashboardSection = document.getElementById("dashboard-container");

            if (user) {
                // Secure Client-Side Handshake check to restrict entry to Admin Uids / Admin emails
                const isAdminUid = user.uid === 'DJdovBPDi4h0xWaCJUL4Uz3xDpF2';
                const isAdminEmail = user.email === 'vivekdalvi147@gmail.com';

                if (isAdminUid || isAdminEmail) {
                    // Hide Login, Show Dashboard
                    loginSection.style.display = "none";
                    dashboardSection.style.display = "block";
                    
                    // Update profile card details
                    document.getElementById("user-avatar").src = user.photoURL || 'https://via.placeholder.com/32';
                    document.getElementById("user-name").innerText = user.displayName || 'Developer';
                } else {
                    alert("Access Denied! Your email (" + user.email + ") is not authorized to access the vRewardX admin dashboard.");
                    auth.signOut();
                }
            } else {
                // Show Login, Hide Dashboard
                loginSection.style.display = "flex";
                dashboardSection.style.display = "none";
            }
        });

        // Sign in with Google Popup
        function googleLogin() {
            const provider = new firebase.auth.GoogleAuthProvider();
            auth.signInWithPopup(provider)
                .then((result) => {
                    console.log("Logged in successfully as: ", result.user.displayName);
                })
                .catch((error) => {
                    console.error("Auth Error: ", error);
                    alert("Authentication Failed: " + error.message);
                });
        }

        // Sign Out function
        function logout() {
            auth.signOut().then(() => {
                console.log("Logged out successfully");
            }).catch((error) => {
                console.error("Logout error: ", error);
            });
        }
    </script>
</body>
</html>
  `;
}

module.exports = async (req, res) => {
  const envDomain = req.headers['host'] || 'pubscale-webhook-vrewardx.vercel.app';
  
  let logs = [];
  let users = [];
  let transactions = [];

  if (firebaseInitialized && db) {
    try {
      // 1. Fetch PubScale callbacks
      const callbacksSnapshot = await db.collection("pubscale_callbacks")
        .orderBy("created_at", "desc")
        .limit(15)
        .get();
        
      callbacksSnapshot.forEach(doc => {
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

    try {
      // 2. Fetch Users
      const usersSnapshot = await db.collection("users")
        .limit(100)
        .get();
        
      usersSnapshot.forEach(doc => {
        const data = doc.data();
        users.push({
          uid: doc.id,
          displayName: data.displayName || "Unknown User",
          email: data.email || "No Email",
          coins: data.coins !== undefined ? data.coins : 0,
          deviceId: data.deviceId || "Empty"
        });
      });
      // Sort users by coin balance descending
      users.sort((a, b) => b.coins - a.coins);
    } catch (err) {
      console.error("Error reading users from Firestore:", err);
    }

    try {
      // 3. Fetch Transactions (Welcome / Redeems) and sort descending in memory to prevent index failure
      const txSnapshot = await db.collection("transactions")
        .limit(150)
        .get();
        
      txSnapshot.forEach(doc => {
        const data = doc.data();
        let ts = data.timestamp;
        if (!ts) {
          ts = Date.now();
        } else if (ts && typeof ts.toDate === "function") {
          ts = ts.toDate().getTime(); // handle firestore Timestamp objects
        }
        transactions.push({
          uid: data.uid || "N/A",
          type: data.type || "N/A",
          title: data.title || "N/A",
          details: data.details || "N/A",
          coinsAmount: data.coinsAmount !== undefined ? data.coinsAmount : 0,
          status: data.status || "N/A",
          timestamp: ts
        });
      });
      transactions.sort((a, b) => b.timestamp - a.timestamp);
      transactions = transactions.slice(0, 30);
    } catch (err) {
      console.error("Error reading transactions from Firestore:", err);
    }
  }

  const html = getDashboardHtml(envDomain, logs, users, transactions, firebaseInitialized, firebaseStatus);
  res.setHeader('Content-Type', 'text/html');
  return res.status(200).send(html);
};
