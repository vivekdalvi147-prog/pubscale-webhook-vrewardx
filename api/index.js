const { admin, db, rtdb, firebaseInitialized, firebaseStatus } = require('./firebase');

function getDashboardHtml(envDomain, firebaseMsg) {
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

        .avatar-img {
            width: 32px;
            height: 32px;
            border-radius: 50%;
            object-fit: cover;
            border: 1.5px solid var(--primary-blue);
        }

        .profile-name {
            font-weight: 600;
            font-size: 0.9em;
            color: #ffffff;
        }

        .logout-btn {
            background: none;
            border: none;
            color: var(--danger-color);
            font-size: 0.85em;
            cursor: pointer;
            padding: 4px 8px;
            border-radius: 4px;
            font-weight: bold;
            transition: background-color 0.2s;
        }

        .logout-btn:hover {
            background-color: rgba(248, 81, 73, 0.1);
        }

        /* CARDS & CONTAINERS */
        .card {
            background-color: var(--card-bg);
            border: 1px solid var(--card-border);
            border-radius: 12px;
            padding: 25px;
            margin-bottom: 25px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
        }

        .card-title {
            font-size: 1.15em;
            font-weight: 700;
            color: #ffffff;
            margin-bottom: 12px;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        /* GRID METRICS */
        .metrics-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 20px;
            margin-bottom: 25px;
            width: 100%;
        }

        .stat-card {
            background-color: var(--card-bg);
            border: 1px solid var(--card-border);
            border-radius: 12px;
            padding: 20px 25px;
            display: flex;
            flex-direction: column;
            justify-content: center;
            box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
            position: relative;
            overflow: hidden;
        }

        .stat-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            width: 4px;
            height: 100%;
            background-color: var(--primary-blue);
        }

        .stat-card:nth-child(2)::before {
            background-color: #3fb950;
        }

        .stat-card:nth-child(3)::before {
            background-color: #ff7b72;
        }

        .stat-value {
            font-size: 2.1em;
            font-weight: 800;
            margin-bottom: 4px;
        }

        .stat-label {
            font-size: 0.85em;
            color: var(--text-secondary);
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        /* TABS MENU */
        .tab-container {
            display: flex;
            border-bottom: 1px solid var(--card-border);
            margin-bottom: 25px;
            gap: 8px;
            overflow-x: auto;
            scrollbar-width: none; /* Hide standard firefox scrollbars */
        }

        .tab-container::-webkit-scrollbar {
            display: none; /* Hide webkit scroll */
        }

        .tab-btn {
            background: none;
            border: none;
            color: var(--text-secondary);
            padding: 12px 20px;
            font-size: 0.95em;
            font-weight: 600;
            cursor: pointer;
            border-bottom: 2px solid transparent;
            transition: all 0.2s;
            white-space: nowrap;
        }

        .tab-btn:hover {
            color: #ffffff;
        }

        .tab-btn.active {
            color: var(--primary-blue);
            border-bottom: 2px solid var(--primary-blue);
        }

        /* TAB PANEL CONTENT */
        .tab-content {
            display: none;
            animation: fadeIn 0.3s ease-in-out;
        }

        .tab-content.active {
            display: block;
        }

        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(8px); }
            to { opacity: 1; transform: translateY(0); }
        }

        .tab-content h2 {
            font-size: 1.4em;
            color: #ffffff;
            margin-top: 0;
            margin-bottom: 8px;
        }

        /* LARGE SYSTEM TABLES */
        .table-responsive {
            width: 100%;
            overflow-x: auto;
            background-color: var(--card-bg);
            border: 1px solid var(--card-border);
            border-radius: 12px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.2);
        }

        .log-table {
            width: 100%;
            border-collapse: collapse;
            text-align: left;
            font-size: 0.9em;
            min-width: 800px;
        }

        .log-table th {
            background-color: #1f242c;
            color: #ffffff;
            padding: 15px;
            font-weight: 600;
            border-bottom: 1px solid var(--card-border);
        }

        .log-table td {
            padding: 15px;
            border-bottom: 1px solid var(--card-border);
            vertical-align: middle;
            line-height: 1.4;
        }

        .log-table tr:hover {
            background-color: #1c212b;
        }

        /* REUSABLE STYLING UTILITIES */
        code {
            font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
            background-color: #1f242c;
            color: #ff7b72;
            padding: 3px 6px;
            border-radius: 6px;
            font-size: 0.9em;
            border: 1px solid rgba(248, 81, 73, 0.15);
        }

        #callback-url {
            color: #58a6ff;
            font-weight: bold;
            font-size: 0.95em;
            padding: 8px 14px;
            border: 1px solid var(--card-border);
            background-color: #0b0f17;
            border-radius: 8px;
            flex-grow: 1;
        }

        .copy-btn {
            background-color: #21262d;
            border: 1px solid var(--card-border);
            color: #c9d1d9;
            padding: 8px 16px;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 500;
            font-size: 0.9em;
            transition: all 0.2s;
        }

        .copy-btn:hover {
            background-color: #30363d;
            border-color: #8b949e;
        }

        .copied-hint {
            color: #3fb950;
            font-size: 0.85em;
            font-weight: bold;
            display: none;
            animation: fadeIn 0.2s ease;
        }

        .success-text {
            color: #3fb950;
            font-weight: bold;
        }

        .error-text {
            color: #f85149;
            font-weight: bold;
        }

        footer {
            text-align: center;
            padding: 35px 20px;
            color: var(--text-secondary);
            font-size: 0.85em;
            width: 100%;
            box-sizing: border-box;
            border-top: 1px dashed var(--card-border);
            margin-top: 20px;
        }

        footer a {
            color: var(--primary-blue);
            text-decoration: none;
        }

        footer a:hover {
            text-decoration: underline;
        }

        @media (max-width: 600px) {
            .navbar {
                flex-direction: column;
                align-items: flex-start;
            }
            .user-profile {
                width: 100%;
                box-sizing: border-box;
                justify-content: space-between;
            }
        }
    </style>
</head>
<body>

    <!-- SECURE GATEWAY LOGIN SCREEN -->
    <div id="login-container" class="login-screen">
        <div class="login-card">
            <img class="login-logo" src="https://i.ibb.co/6N6K4zS/reward.png" alt="vRewardX Logo">
            <h2>vRewardX Server Panel</h2>
            <p>Authorized access required. Sign in with developer's authenticated credentials to administer transaction postbacks securely.</p>
            <button class="google-btn" onclick="googleLogin()">
                <img src="https://i.ibb.co/72Y8Bsy/google-icon.png" alt="Google G Logo">
                Sign in with Google Account
            </button>
        </div>
    </div>

    <!-- MAIN ADMINISTRATIVE WORKPLACE (HIDDEN INITIALLY) -->
    <div id="dashboard-container" class="dashboard-container">
        
        <!-- SECURE HEADER NAVIGATION BAR -->
        <div class="navbar">
            <div class="brand-logo-area">
                <img class="brand-logo-img" src="https://i.ibb.co/6N6K4zS/reward.png" alt="vRewardX Web Logo">
                <div class="brand-title-wrap">
                    <h1>vRewardX Console <span class="developer-badge">Live Admin Control</span></h1>
                </div>
            </div>
            <div class="user-profile">
                <img id="user-avatar" class="avatar-img" src="" alt="User Avatar">
                <span id="user-name" class="profile-name">Admin Loader</span>
                <button class="logout-btn" onclick="logout()">LOGOUT</button>
            </div>
        </div>

        <!-- STAT CARDS REALTIME METRICS GRID -->
        <div class="metrics-grid">
            <div class="stat-card">
                <div class="stat-value" id="stat-registered-users" style="color: #58a6ff;">-</div>
                <div class="stat-label">Total Registered Users</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" id="stat-circulation-coins" style="color: #3fb950;">-</div>
                <div class="stat-label">Total Coins in Circulation</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" id="stat-pending-withdrawals" style="color: #ff7b72;">-</div>
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
            <button id="tab-btn-logs" class="tab-btn active" onclick="switchTab('pubscale-logs')">🛡️ Pubscale hook webhooks</button>
            <button id="tab-btn-users" class="tab-btn" onclick="switchTab('app-users')">👥 Registered App Users</button>
            <button id="tab-btn-txs" class="tab-btn" onclick="switchTab('s2s-transactions')">📜 Secure S2S Activity Logs</button>
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
                    <tbody id="logs-tbody">
                        <tr><td colspan="6" style="text-align: center; color: #8b949e; padding: 20px;">Fetching dashboard logs...</td></tr>
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
                    <tbody id="users-tbody">
                        <tr><td colspan="5" style="text-align: center; color: #8b949e; padding: 20px;">Fetching dynamic user profiles...</td></tr>
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
                    <tbody id="transactions-tbody">
                        <tr><td colspan="6" style="text-align: center; color: #8b949e; padding: 20px;">Fetching transactions...</td></tr>
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
            messagingSenderId: "17385960410",
            appId: "1:17385960410:web:8e30bba0dfb8418acbf8ab"
        };

        // Initialize Firebase SDK Compat layers
        firebase.initializeApp(firebaseConfig);
        const auth = firebase.auth();

        // Switch Administrative Workspace categories on the Client
        function switchTab(tabId) {
            // Hide all panels
            const tabs = document.getElementsByClassName("tab-content");
            for (let i = 0; i < tabs.length; i++) {
                tabs[i].classList.remove("active");
            }
            
            // Remove active style from all menu buttons
            const buttons = document.getElementsByClassName("tab-btn");
            for (let i = 0; i < buttons.length; i++) {
                buttons[i].classList.remove("active");
            }

            // Expose active panel & highlight button
            document.getElementById(tabId).classList.add("active");
            
            let btnId = "tab-btn-logs";
            if (tabId === "app-users") btnId = "tab-btn-users";
            else if (tabId === "s2s-transactions") btnId = "tab-btn-txs";
            document.getElementById(btnId).classList.add("active");
        }

        // Copy callback URL helpers
        function copyText(elemId, hintId) {
            const urlText = document.getElementById(elemId).innerText;
            navigator.clipboard.writeText(urlText).then(() => {
                const hint = document.getElementById(hintId);
                hint.style.display = "inline-block";
                setTimeout(() => {
                    hint.style.display = "none";
                }, 2000);
            }).catch(err => {
                console.error("Copy failed due to permissions constraints:", err);
            });
        }

        // Watch Authentication State
        auth.onAuthStateChanged(async (user) => {
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

                    // Fetch admin statistics and logs securely from backend!
                    try {
                        const idToken = await user.getIdToken();
                        const response = await fetch('/api', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': 'Bearer ' + idToken
                            }
                        });
                        const data = await response.json();
                        if (data.success) {
                            renderAdminData(data);
                        } else {
                            alert("Access Denied: " + data.error);
                            auth.signOut();
                        }
                    } catch (err) {
                        console.error("Failed to load dashboard data:", err);
                        alert("Failed to load dashboard data from server.");
                        auth.signOut();
                    }
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

        function renderAdminData(data) {
            // Render Stats
            document.getElementById("stat-registered-users").innerText = data.stats.totalRegisteredUsers;
            document.getElementById("stat-pending-withdrawals").innerText = data.stats.pendingRedemptions;
            document.getElementById("stat-circulation-coins").innerText = data.stats.totalCoinsInCirculation;

            document.getElementById("tab-btn-users").innerText = "👥 Registered App Users (" + data.stats.totalRegisteredUsers + ")";
            document.getElementById("tab-btn-txs").innerText = "📜 Secure S2S Activity Logs (" + data.transactions.length + ")";

            // Render Logs/Callbacks
            const logsTbody = document.getElementById("logs-tbody");
            if (data.logs.length === 0) {
                logsTbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #8b949e; padding: 20px;">Waiting for test callbacks from PubScale dashboard...</td></tr>';
            } else {
                logsTbody.innerHTML = data.logs.map(item => \`
                    <tr>
                        <td>\${item.timestamp}</td>
                        <td><code>\${item.user_id}</code></td>
                        <td><strong style="color: #79c0ff;">+\${item.value} Coins</strong></td>
                        <td><code style="font-size: 0.85em;">\${item.token}</code></td>
                        <td>
                            \${item.verified 
                                ? \\\`<span class="success-text">✓ Verified Signature</span><br><small style="color: #8b949e; font-size: 0.85em;">Formula: \${item.formula}</small>\\\` 
                                : \\\`<span class="error-text">✗ Verification Mismatch</span>\\\`
                            }
                        </td>
                        <td>
                            \${item.verified 
                                ? (item.db_success 
                                        ? \\\`<span class="success-text">✓ Real Value Credited</span>\\\` 
                                        : \\\`<span class="error-text">✗ Failed db update</span>\\\`
                                    ) + \\\`<br><small style="color: #8b949e; font-size: 0.85em;">\${item.db_msg}</small>\\\`
                                : \\\`<span style="color: #8b949e;">Blocked</span>\\\`
                            }
                        </td>
                    </tr>
                \`).join('');
            }

            // Render Users
            const usersTbody = document.getElementById("users-tbody");
            if (data.users.length === 0) {
                usersTbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #8b949e; padding: 20px;">No registered users synchronized yet...</td></tr>';
            } else {
                usersTbody.innerHTML = data.users.map(item => \`
                    <tr>
                        <td><strong style="color: #ffffff;">\${item.displayName}</strong></td>
                        <td><code>\${item.uid}</code></td>
                        <td><span style="color: #8b949e;">\${item.email}</span></td>
                        <td><strong style="color: #58a6ff;">\${item.coins} Coins</strong></td>
                        <td><code style="font-size: 0.85em; color: #ff7b72;">\${item.deviceId}</code></td>
                    </tr>
                \`).join('');
            }

            // Render Transactions
            const txTbody = document.getElementById("transactions-tbody");
            if (data.transactions.length === 0) {
                txTbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #8b949e; padding: 20px;">No S2S transaction logs found in database...</td></tr>';
            } else {
                txTbody.innerHTML = data.transactions.map(item => {
                    const formattedDate = new Date(item.timestamp).toLocaleString();
                    const badgeColor = item.type === "REDEEM" ? "color: #f85149;" : "color: #3fb950;";
                    return \`
                        <tr>
                            <td>\${formattedDate}</td>
                            <td><code>\${item.uid}</code></td>
                            <td><strong style="\${badgeColor}">\${item.type}</strong></td>
                            <td>
                                <div style="font-weight: bold; color: #ffffff;">\${item.title}</div>
                                <small style="color: var(--text-secondary); font-size: 0.85em;">\${item.details}</small>
                            </td>
                            <td><strong style="\${badgeColor}">\${item.type === "REDEEM" ? "-" : "+"}\${item.coinsAmount} Coins</strong></td>
                            <td>
                                \${item.status === "SUCCESS" 
                                    ? '\\\<span class="success-text" style="font-size: 0.9em; font-weight: bold;">✓ APPROVED</span>\\\''
                                    : item.status === "PENDING"
                                        ? '\\\<span style="color: #d29922; font-size: 0.9em; font-weight: bold;">⏳ PENDING</span>\\\''
                                        : '\\\<span class="error-text" style="font-size: 0.9em; font-weight: bold;">✗ REJECTED</span>\\\''
                                }
                            </td>
                        </tr>
                    \`;
                }).join('');
            }
        }

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
  
  if (req.method === 'POST') {
    // SECURE S2S POSTBACK DATA ENDPOINT - PROTECTS SENSITIVE VISUAL RECORDS FROM COLD RETRIEVAL SPLITS!
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: "Missing admin access context." });
    }

    const idToken = authHeader.split('Bearer ')[1];
    if (!firebaseInitialized || !rtdb) {
      return res.status(503).json({ success: false, error: "Database offline." });
    }

    try {
      // 1. Decrypt & verify identity
      const decodedToken = await admin.auth().verifyIdToken(idToken, true);
      const uid = decodedToken.uid;
      const email = decodedToken.email || "";

      const isAdminUid = uid === 'DJdovBPDi4h0xWaCJUL4Uz3xDpF2';
      const isAdminEmail = email === 'vivekdalvi147@gmail.com';

      if (!isAdminUid && !isAdminEmail) {
        return res.status(403).json({ success: false, error: "Unauthorized access: Administrator account status needed." });
      }

      let logs = [];
      let users = [];
      let transactions = [];

      // A. Fetch Callbacks
      try {
        const callbacksSnapshot = await rtdb.ref("pubscale_callbacks")
          .limitToLast(15)
          .get();
          
        if (callbacksSnapshot.exists()) {
          callbacksSnapshot.forEach(child => {
            const data = child.val();
            logs.unshift({
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
        }
      } catch (err) {
        console.error("Error reading logs from RTDB:", err);
      }

      // B. Fetch Users
      try {
        const usersSnapshot = await rtdb.ref("users")
          .limitToLast(100)
          .get();
          
        if (usersSnapshot.exists()) {
          usersSnapshot.forEach(child => {
            const data = child.val();
            users.push({
              uid: child.key,
              displayName: data.displayName || "Unknown User",
              email: data.email || "No Email",
              coins: data.coins !== undefined ? data.coins : 0,
              deviceId: data.deviceId || "Empty"
            });
          });
        }
        users.sort((a, b) => b.coins - a.coins);
      } catch (err) {
        console.error("Error reading users from RTDB:", err);
      }

      // C. Fetch S2S Logs
      try {
        const txSnapshot = await rtdb.ref("transactions")
          .limitToLast(150)
          .get();
          
        if (txSnapshot.exists()) {
          txSnapshot.forEach(child => {
            const val = child.val();
            if (val && typeof val === 'object') {
              if (val.uid && typeof val.uid === 'string') {
                transactions.push({
                  uid: val.uid || "N/A",
                  type: val.type || "N/A",
                  title: val.title || "N/A",
                  details: val.details || "N/A",
                  coinsAmount: val.coinsAmount !== undefined ? val.coinsAmount : 0,
                  status: val.status || "N/A",
                  timestamp: val.timestamp || Date.now()
                });
              } else {
                Object.keys(val).forEach(txId => {
                  const txVal = val[txId];
                  if (txVal && typeof txVal === 'object') {
                    transactions.push({
                      uid: txVal.uid || "N/A",
                      type: txVal.type || "N/A",
                      title: txVal.title || "N/A",
                      details: txVal.details || "N/A",
                      coinsAmount: txVal.coinsAmount !== undefined ? txVal.coinsAmount : 0,
                      status: txVal.status || "N/A",
                      timestamp: txVal.timestamp || Date.now()
                    });
                  }
                });
              }
            }
          });
        }
        transactions.sort((a, b) => b.timestamp - a.timestamp);
        transactions = transactions.slice(0, 30);
      } catch (err) {
        console.error("Error reading transactions from RTDB:", err);
      }

      const totalRegisteredUsers = users.length;
      const pendingRedemptions = transactions.filter(t => t.type === "REDEEM" && t.status === "PENDING").length;
      const totalCoinsInCirculation = users.reduce((acc, curr) => acc + (curr.coins || 0), 0);

      return res.status(200).json({
        success: true,
        logs,
        users,
        transactions,
        stats: {
          totalRegisteredUsers,
          pendingRedemptions,
          totalCoinsInCirculation
        }
      });

    } catch (e) {
      console.error("Admin visual token authentication check failed:", e);
      return res.status(403).json({ success: false, error: "Access handshake rejected." });
    }
  }

  // GET DEFAULT REQUEST RENDERS IMMUTABLE SAFE HTML SHELL WITH NO PERSISTENT ACCOUNT RECORDS PRE-INJECTED!
  const html = getDashboardHtml(envDomain, firebaseStatus);
  res.setHeader('Content-Type', 'text/html');
  return res.status(200).send(html);
};
