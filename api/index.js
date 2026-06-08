const admin = require('firebase-admin');

// Initialize Firebase Admin SDK (Kept for backend verification & other API routes)
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
    firebaseStatus = "Passive Mode. Configure FIREBASE credentials in Vercel.";
  }
} catch (e) {
  firebaseStatus = `Firebase initialization error: ${e.message}`;
  console.error("Firebase Admin init error:", e);
}

// Function to generate the Premium Tailwind HTML
function getDashboardHtml(envDomain) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>vRewardX Premium Web Admin & S2S Console 👑</title>
    <!-- Tailwind CSS -->
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
        tailwind.config = {
            theme: {
                extend: {
                    colors: {
                        brand: {
                            bg: '#090D1A',
                            card: '#111726',
                            border: '#1F293D',
                            accent: '#3B82F6',
                            success: '#10B981',
                            error: '#EF4444',
                            warning: '#F59E0B'
                        }
                    }
                }
            }
        }
    </script>
    <!-- Google Fonts -->
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght=400;500;600;700;800&display=swap" rel="stylesheet">
    <!-- Lucide Icons -->
    <script src="https://unpkg.com/lucide@latest"></script>
    <!-- Firebase Compat SDKs -->
    <script src="https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/10.8.0/firebase-auth-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore-compat.js"></script>
    <style>
        body { font-family: 'Plus Jakarta Sans', sans-serif; background-color: #070A13; color: #E2E8F0; }
        .glow-btn:hover { box-shadow: 0 0 15px rgba(59, 130, 246, 0.4); }
        .glow-success:hover { box-shadow: 0 0 15px rgba(16, 185, 129, 0.4); }
        .glow-error:hover { box-shadow: 0 0 15px rgba(239, 68, 68, 0.4); }
        .animate-fade-in { animation: fadeIn 0.3s ease-out forwards; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    </style>
</head>
<body class="min-h-screen pb-16">
    <!-- Header -->
    <header class="border-b border-brand-border bg-brand-bg/80 backdrop-blur sticky top-0 z-40 px-6 py-4">
        <div class="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
            <div class="flex items-center gap-3">
                <div class="p-2.5 bg-brand-accent/15 border border-brand-accent/30 rounded-xl text-brand-accent shadow-[0_0_20px_rgba(59,130,246,0.35)]">
                    <i data-lucide="crown" class="w-6 h-6"></i>
                </div>
                <div>
                    <h1 class="text-xl font-extrabold tracking-tight text-white flex items-center gap-2">
                        vRewardX <span class="bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent text-xs font-semibold px-2 py-0.5 border border-brand-border rounded-full bg-slate-900/60">Server & Webhook Admin</span>
                    </h1>
                    <p class="text-[11px] text-slate-400">Serverless Control Center for Real-time Management & S2S Postbacks</p>
                </div>
            </div>
            
            <div class="flex items-center gap-4">
                <div id="conn-badge" class="flex items-center gap-2 bg-slate-900/80 px-4 py-2 border border-brand-error/20 rounded-xl">
                    <span class="w-2.5 h-2.5 bg-brand-error rounded-full animate-ping"></span>
                    <span class="text-xs font-semibold text-slate-300">Database Offline</span>
                </div>
                <div id="user-profile" class="hidden items-center gap-2 bg-slate-900/80 border border-brand-border rounded-xl p-1.5 pr-4">
                    <img id="user-avatar" class="w-8 h-8 rounded-lg object-cover" src="" alt="Admin">
                    <div class="flex flex-col">
                        <span id="user-name" class="text-xs font-bold text-white">Admin</span>
                        <span class="text-[9px] text-brand-accent">Root Access</span>
                    </div>
                </div>
            </div>
        </div>
    </header>

    <main class="max-w-7xl mx-auto px-6 mt-8">
        <!-- Login Panel -->
        <section id="step-setup" class="bg-brand-card border border-brand-border rounded-3xl p-8 max-w-md mx-auto shadow-2xl relative overflow-hidden animate-fade-in">
            <div class="absolute top-0 right-0 w-64 h-64 bg-brand-accent/10 rounded-full blur-3xl -z-10"></div>
            <div class="text-center mb-6">
                <div class="w-16 h-16 bg-brand-accent/10 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-brand-accent/20">
                    <i data-lucide="shield-check" class="text-brand-accent w-8 h-8 animate-pulse"></i>
                </div>
                <h2 class="text-2xl font-bold text-white mb-2">vRewardX Portal</h2>
                <p class="text-xs text-slate-400 max-w-xs mx-auto leading-relaxed">Access restricted to authorized server administrators only.</p>
            </div>

            <div id="login-loading-screen" class="py-8 text-center">
                <div class="flex items-center justify-center gap-2 text-brand-accent text-sm font-semibold animate-pulse mb-2">
                    <span class="w-1.5 h-1.5 bg-brand-accent rounded-full animate-ping"></span> Initializing secure handshake...
                </div>
            </div>

            <form id="admin-login-form" class="hidden space-y-4 text-left" onsubmit="handleAdminLogin(event)">
                <button type="button" id="btn-google-login" onclick="handleGoogleLogin()" class="w-full bg-slate-900 border border-brand-border hover:bg-slate-800/80 text-white font-bold text-sm tracking-wide py-3.5 rounded-xl transition active:scale-95 flex items-center justify-center gap-3">
                     <svg class="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="#EA4335" d="M12.24 10.285V14.4h6.887c-.648 2.41-2.519 4.114-5.136 4.114A5.79 5.79 0 0 1 8.2 12.725a5.79 5.79 0 0 1 5.79-5.79c2.518 0 4.417 1.058 5.373 1.971l3.223-3.223C20.612 3.842 17.583 2.5 13.99 2.5A10.24 10.24 0 0 0 3.75 12.74a10.24 10.24 0 0 0 10.24 10.24c5.79 0 10.117-4.07 10.117-10.24 0-.649-.071-1.123-.195-1.455H12.24z"/></svg>
                     <span>Sign In with Google Account</span>
                </button>
                <div class="flex items-center my-4">
                    <hr class="w-full border-brand-border/60"><span class="px-3 text-[10px] uppercase text-slate-500 font-extrabold tracking-widest whitespace-nowrap">or use admin password</span><hr class="w-full border-brand-border/60">
                </div>
                <div>
                    <label class="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Admin Gmail Address</label>
                    <div class="relative">
                        <i data-lucide="mail" class="absolute left-3.5 top-3.5 text-slate-500 w-4 h-4"></i>
                        <input type="email" id="login-email" required value="vivekdalvi147@gmail.com" class="w-full bg-slate-950/80 border border-brand-border rounded-xl pl-10 pr-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-accent/50 focus:border-brand-accent transition">
                    </div>
                </div>
                <div>
                    <label class="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Secret Portal Password</label>
                    <div class="relative">
                        <i data-lucide="lock" class="absolute left-3.5 top-3.5 text-slate-500 w-4 h-4"></i>
                        <input type="password" id="login-password" required placeholder="••••••••••••" class="w-full bg-slate-950/80 border border-brand-border rounded-xl pl-10 pr-12 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-accent/50 focus:border-brand-accent transition">
                    </div>
                </div>
                <div id="login-error-container" class="hidden bg-brand-error/10 border border-brand-error/30 text-brand-error rounded-xl p-3 text-xs flex gap-2">
                    <i data-lucide="alert-circle" class="w-4 h-4 flex-shrink-0"></i><span id="login-error-text">Authentication failed.</span>
                </div>
                <button type="submit" id="btn-login-submit" class="w-full glow-btn bg-brand-accent hover:bg-brand-accent/90 text-white font-bold text-sm tracking-wide py-3.5 rounded-xl transition active:scale-95 flex items-center justify-center gap-2">
                    <i data-lucide="key" class="w-4 h-4"></i> Authenticate & Enter Console
                </button>
            </form>
        </section>

        <!-- Dashboard -->
        <section id="admin-dashboard" class="hidden space-y-8 animate-fade-in">
            <!-- Tabs -->
            <div class="flex border-b border-brand-border gap-2 pb-px overflow-x-auto">
                <button onclick="switchTab('tab-overview')" id="btn-tab-overview" class="tab-btn px-6 py-4 text-sm font-bold flex items-center gap-2 border-b-2 border-brand-accent text-white whitespace-nowrap">
                    <i data-lucide="sliders" class="w-4 h-4"></i> System Diagnostics
                </button>
                <button onclick="switchTab('tab-users')" id="btn-tab-users" class="tab-btn px-6 py-4 text-sm font-bold flex items-center gap-2 border-b-2 border-transparent text-slate-400 hover:text-white transition whitespace-nowrap">
                    <i data-lucide="users" class="w-4 h-4"></i> User Wallets <span id="users-count-badge" class="ml-1.5 bg-brand-bg px-2 py-0.5 text-xs text-brand-accent rounded-full border border-brand-accent/20">0</span>
                </button>
                <button onclick="switchTab('tab-claims')" id="btn-tab-claims" class="tab-btn px-6 py-4 text-sm font-bold flex items-center gap-2 border-b-2 border-transparent text-slate-400 hover:text-white transition whitespace-nowrap">
                    <i data-lucide="wallet" class="w-4 h-4"></i> Pending Claims <span id="claims-count-badge" class="ml-1.5 bg-brand-bg px-2 py-0.5 text-xs text-brand-warning rounded-full border border-brand-warning/20">0</span>
                </button>
                <button onclick="switchTab('tab-webhooks')" id="btn-tab-webhooks" class="tab-btn px-6 py-4 text-sm font-bold flex items-center gap-2 border-b-2 border-transparent text-slate-400 hover:text-white transition whitespace-nowrap">
                    <i data-lucide="webhook" class="w-4 h-4"></i> S2S Webhooks & Logs
                </button>
                <button onclick="switchTab('tab-settings')" id="btn-tab-settings" class="tab-btn px-6 py-4 text-sm font-bold flex items-center gap-2 border-b-2 border-transparent text-slate-400 hover:text-white transition whitespace-nowrap">
                    <i data-lucide="settings" class="w-4 h-4"></i> System Settings
                </button>
                <button onclick="disconnectDb()" class="ml-auto px-4 py-2 text-xs font-semibold border border-brand-error/25 bg-brand-error/5 hover:bg-brand-error/15 text-brand-error rounded-xl self-center transition flex items-center gap-1.5 active:scale-95 whitespace-nowrap">
                    <i data-lucide="log-out" class="w-3.5 h-3.5"></i> Logout
                </button>
            </div>

            <!-- Tab 1: Overview -->
            <div id="tab-overview" class="tab-pane space-y-8">
                <div class="grid grid-cols-1 md:grid-cols-4 gap-6">
                    <div class="bg-brand-card border border-brand-border rounded-2xl p-6 relative overflow-hidden">
                        <div class="flex justify-between items-start mb-4"><span class="text-xs font-bold uppercase text-slate-400">Verified Accounts</span><i data-lucide="users" class="text-brand-accent w-5 h-5"></i></div>
                        <h3 id="stat-total-users" class="text-3xl font-extrabold text-white">0</h3>
                    </div>
                    <div class="bg-brand-card border border-brand-border rounded-2xl p-6 relative overflow-hidden">
                        <div class="flex justify-between items-start mb-4"><span class="text-xs font-bold uppercase text-slate-400">Circulating Value</span><i data-lucide="circle-dot" class="text-brand-warning w-5 h-5"></i></div>
                        <h3 id="stat-total-coins" class="text-3xl font-extrabold text-white">0</h3>
                    </div>
                    <div class="bg-brand-card border border-brand-border rounded-2xl p-6 relative overflow-hidden">
                        <div class="flex justify-between items-start mb-4"><span class="text-xs font-bold uppercase text-slate-400">Settled Payouts</span><i data-lucide="check-circle" class="text-brand-success w-5 h-5"></i></div>
                        <h3 id="stat-total-pro" class="text-3xl font-extrabold text-white">₹0</h3>
                    </div>
                    <div class="bg-brand-card border border-brand-border rounded-2xl p-6 relative overflow-hidden border-brand-warning/15">
                        <div class="flex justify-between items-start mb-4"><span class="text-xs font-bold uppercase text-slate-400">Pending Approvals</span><i data-lucide="clock" class="text-brand-warning w-5 h-5"></i></div>
                        <h3 id="stat-pending-claims" class="text-3xl font-extrabold text-white">0</h3>
                    </div>
                </div>
            </div>

            <!-- Tab 2: Users -->
            <div id="tab-users" class="tab-pane hidden space-y-6">
                <div class="flex flex-col md:flex-row justify-between items-center gap-4 bg-slate-950 p-4 border border-brand-border rounded-2xl">
                    <div class="relative w-full md:max-w-md">
                        <i data-lucide="search" class="absolute left-4 top-3.5 text-slate-500 w-4 h-4"></i>
                        <input type="text" id="user-filter" oninput="renderUsersTable()" placeholder="Search profiles..." class="w-full bg-brand-bg border border-brand-border rounded-xl pl-12 pr-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-accent/50 focus:border-brand-accent transition">
                    </div>
                </div>
                <div class="bg-brand-card border border-brand-border rounded-3xl overflow-hidden shadow-2xl">
                    <div class="overflow-x-auto font-medium">
                        <table class="w-full text-left border-collapse whitespace-nowrap">
                            <thead>
                                <tr class="bg-slate-950/80 border-b border-brand-border text-slate-400 text-[10px] font-bold tracking-wider uppercase">
                                    <th class="px-6 py-4.5">Account Details</th>
                                    <th class="px-6 py-4.5">Security Parameters</th>
                                    <th class="px-6 py-4.5">UPI ID</th>
                                    <th class="px-6 py-4.5">Coin Wallet</th>
                                    <th class="px-6 py-4.5 text-center">Status & Actions</th>
                                </tr>
                            </thead>
                            <tbody id="users-table-rows" class="divide-y divide-brand-border text-sm"></tbody>
                        </table>
                    </div>
                </div>
            </div>

            <!-- Tab 3: Claims -->
            <div id="tab-claims" class="tab-pane hidden space-y-6">
                <div class="bg-brand-card border border-brand-border rounded-3xl overflow-hidden shadow-2xl">
                    <div class="overflow-x-auto">
                        <table class="w-full text-left border-collapse whitespace-nowrap">
                            <thead>
                                <tr class="bg-slate-950/80 border-b border-brand-border text-slate-400 text-[10px] font-bold tracking-wider uppercase">
                                    <th class="px-6 py-4.5">Redemption Item Details</th>
                                    <th class="px-6 py-4.5">Target Wallet Address</th>
                                    <th class="px-6 py-4.5">Time Log</th>
                                    <th class="px-6 py-4.5 text-center">Action Decisions</th>
                                </tr>
                            </thead>
                            <tbody id="claims-table-rows" class="divide-y divide-brand-border text-sm"></tbody>
                        </table>
                    </div>
                </div>
            </div>

            <!-- Tab 4: Webhooks & S2S -->
            <div id="tab-webhooks" class="tab-pane hidden space-y-8 animate-fade-in">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div class="bg-brand-card border border-brand-border rounded-3xl p-6 shadow-xl">
                        <h3 class="text-sm font-bold text-brand-accent mb-3 flex items-center gap-2"><i data-lucide="shield-check" class="w-4 h-4"></i> Secure S2S APIs</h3>
                        <div class="space-y-4">
                            <div class="pb-3 border-b border-brand-border/50">
                                <span class="text-[10px] text-brand-accent font-bold uppercase tracking-wider block mb-1">1. Google Signups (POST)</span>
                                <code class="bg-slate-950 text-emerald-400 border border-brand-border px-3 py-1.5 rounded-lg text-xs font-mono block w-full mb-2 truncate">https://${envDomain}/api/signup</code>
                            </div>
                            <div>
                                <span class="text-[10px] text-brand-accent font-bold uppercase tracking-wider block mb-1">2. Payout Controller (POST)</span>
                                <code class="bg-slate-950 text-emerald-400 border border-brand-border px-3 py-1.5 rounded-lg text-xs font-mono block w-full mb-2 truncate">https://${envDomain}/api/redeem</code>
                            </div>
                        </div>
                    </div>
                    <div class="bg-brand-card border border-brand-border rounded-3xl p-6 shadow-xl flex flex-col justify-between">
                        <div>
                            <h3 class="text-sm font-bold text-brand-success mb-3 flex items-center gap-2"><i data-lucide="link" class="w-4 h-4"></i> PubScale Webhook Callback</h3>
                            <div class="flex items-center gap-3 bg-slate-950 p-3 rounded-xl border border-brand-border">
                                <code id="callback-url" class="text-xs text-slate-300 font-mono flex-grow truncate">https://${envDomain}/api/callback?uid={user_id}&coins={currency}</code>
                                <button onclick="copyText('callback-url', 'cb-hint')" class="p-2 bg-brand-border/50 hover:bg-brand-border rounded-lg transition text-slate-300"><i data-lucide="copy" class="w-4 h-4"></i></button>
                            </div>
                            <span id="cb-hint" class="hidden text-[10px] text-brand-success mt-1 font-bold ml-1 transition">Copied to clipboard!</span>
                        </div>
                        <p class="text-[11px] text-brand-warning font-semibold mt-4 bg-brand-warning/10 border border-brand-warning/20 p-2.5 rounded-lg flex gap-2 items-center">
                            <i data-lucide="zap" class="w-4 h-4"></i> Select GET as request method inside PubScale.
                        </p>
                    </div>
                </div>

                <div class="bg-brand-card border border-brand-border rounded-3xl overflow-hidden shadow-2xl">
                    <div class="px-6 py-5 border-b border-brand-border flex items-center justify-between bg-slate-950/50">
                        <h3 class="text-sm font-bold text-white flex items-center gap-2"><i data-lucide="server" class="w-4 h-4 text-slate-400"></i> Live PubScale Webhook Logs</h3>
                        <span class="bg-brand-success/15 text-brand-success border border-brand-success/20 text-[9px] px-2.5 py-1 font-extrabold rounded-full uppercase">Real-time Stream</span>
                    </div>
                    <div class="overflow-x-auto">
                        <table class="w-full text-left border-collapse whitespace-nowrap">
                            <thead>
                                <tr class="bg-slate-950/80 border-b border-brand-border text-slate-400 text-[10px] font-bold tracking-wider uppercase">
                                    <th class="px-6 py-4.5">Timestamp</th>
                                    <th class="px-6 py-4.5">User ID (Uid)</th>
                                    <th class="px-6 py-4.5">Token / Hash</th>
                                    <th class="px-6 py-4.5">Verification</th>
                                    <th class="px-6 py-4.5">Value</th>
                                    <th class="px-6 py-4.5">DB Status</th>
                                </tr>
                            </thead>
                            <tbody id="s2s-logs-table-rows" class="divide-y divide-brand-border text-sm"></tbody>
                        </table>
                    </div>
                </div>
            </div>

            <!-- Tab 5: Settings -->
            <div id="tab-settings" class="tab-pane hidden space-y-8 animate-fade-in">
                <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <div class="bg-brand-card border border-brand-border rounded-3xl p-6 space-y-6 relative">
                        <h3 class="text-base font-bold text-white flex items-center gap-2"><i data-lucide="toggle-left" class="text-brand-accent"></i> Global Remote Constants</h3>
                        <div class="space-y-4">
                            <div class="bg-slate-950 border border-brand-border rounded-2xl p-4 space-y-3">
                                <div class="flex items-center justify-between">
                                    <div>
                                        <h4 class="text-sm font-bold text-white flex items-center gap-1.5">Maintenance Lock <span id="badge-lock-status" class="bg-brand-success/15 border border-brand-success/30 text-brand-success text-[9px] px-1.5 py-0.5 rounded uppercase font-extrabold">Inactive</span></h4>
                                    </div>
                                    <label class="relative inline-flex items-center cursor-pointer">
                                        <input type="checkbox" id="settings-maintenance" class="sr-only peer" onchange="toggleLocalLockIndicator()">
                                        <div class="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-300 after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-accent"></div>
                                    </label>
                                </div>
                                <button type="button" onclick="saveMaintenanceLockState()" class="w-full bg-brand-accent/20 hover:bg-brand-accent/30 text-white border border-brand-accent/40 py-2.5 px-3 rounded-xl font-bold text-xs tracking-wide transition active:scale-95 flex items-center justify-center gap-1.5">🔒 Save Lock Status</button>
                            </div>
                            <div>
                                <label class="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Min App Version</label>
                                <input type="text" id="settings-min-version" class="w-full bg-slate-950 border border-brand-border rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-brand-accent transition">
                            </div>
                            <div>
                                <label class="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Update URL</label>
                                <input type="text" id="settings-download-url" class="w-full bg-slate-950 border border-brand-border rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-brand-accent transition">
                            </div>
                            <button onclick="saveGlobalSettings()" class="w-full glow-success bg-brand-success/15 hover:bg-brand-success/25 border border-brand-success/30 text-brand-success py-3 rounded-xl font-bold text-sm tracking-wide transition active:scale-95 flex items-center justify-center gap-1.5"><i data-lucide="save" class="w-4 h-4"></i> Commit Settings</button>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    </main>

    <!-- Modals -->
    <div id="modal-coin" class="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 hidden">
        <div class="bg-brand-card border border-brand-border p-6 rounded-3xl max-w-sm w-full space-y-4 shadow-2xl relative">
            <h3 class="text-base font-extrabold text-white flex items-center gap-2"><i data-lucide="edit-3" class="text-brand-accent w-5 h-5"></i> Adjust Wallet Credit</h3>
            <p id="modal-coin-desc" class="text-xs text-slate-400">Reconcile currency counts...</p>
            <div class="space-y-4">
                <input type="number" id="coin-change-num" value="500" class="w-full bg-slate-950 border border-brand-border rounded-xl px-4 py-3 text-sm font-bold text-white focus:outline-none focus:ring-1 focus:ring-brand-accent">
                <div class="flex gap-2">
                    <button onclick="submitCoinAdjust('add')" class="w-1/2 glow-success bg-brand-success/15 hover:bg-brand-success/25 border border-brand-success/30 text-brand-success py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition">Credit (+)</button>
                    <button onclick="submitCoinAdjust('sub')" class="w-1/2 glow-error bg-brand-error/15 hover:bg-brand-error/25 border border-brand-error/30 text-brand-error py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition">Deduct (-)</button>
                </div>
            </div>
            <div class="border-t border-brand-border pt-4 flex justify-end"><button onclick="closeModal('modal-coin')" class="text-xs text-slate-400 hover:text-white font-bold transition">Close</button></div>
        </div>
    </div>

    <div id="modal-settle" class="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 hidden">
        <div class="bg-brand-card border border-brand-border p-6 rounded-3xl max-w-sm w-full space-y-4 shadow-2xl relative">
            <h3 id="settle-title" class="text-base font-extrabold text-white flex items-center gap-2"><i data-lucide="check-square" class="text-brand-success w-5 h-5"></i> Payout Claim Audit</h3>
            <p id="settle-desc" class="text-xs text-slate-400">Verification details</p>
            <div class="space-y-3">
                <textarea id="settle-notes" class="w-full bg-slate-950 border border-brand-border rounded-xl px-4 py-2.5 text-xs text-white h-24 focus:outline-none focus:ring-1 focus:ring-brand-accent"></textarea>
            </div>
            <div class="flex gap-2 justify-end pt-2 border-t border-brand-border">
                <button onclick="closeModal('modal-settle')" class="mr-auto text-xs text-slate-400 hover:text-white font-bold transition self-center">Cancel</button>
                <button id="btn-submit-reject" class="glow-error bg-brand-error/15 hover:bg-brand-error/25 border border-brand-error/30 text-brand-error px-4 py-2 text-xs font-bold rounded-xl transition uppercase tracking-wider">Reject</button>
                <button id="btn-submit-approve" class="glow-success bg-brand-success/15 hover:bg-brand-success/25 border border-brand-success/30 text-brand-success px-4 py-2 text-xs font-bold rounded-xl transition uppercase tracking-wider">Settle</button>
            </div>
        </div>
    </div>

    <script>
        const defaultFirebaseConfig = {
            apiKey: "AIzaSyBCROZHQcXGxZCupI0dg0Ehx2_i0SKINls",
            authDomain: "vrewardx.firebaseapp.com",
            projectId: "vrewardx",
            storageBucket: "vrewardx.firebasestorage.app",
            messagingSenderId: "446047163907",
            appId: "1:446047163907:web:9aa45be59b0476699c2036",
            measurementId: "G-GBVZZ517HF"
        };

        var db = null;
        var globalUsers = [];
        var globalTransactions = [];
        var globalWebhooks = [];
        var activeCoinsUserUid = "";
        var activeSettleTxDocId = "";

        function copyText(elementId, hintId) {
            const text = document.getElementById(elementId).innerText;
            navigator.clipboard.writeText(text);
            const hint = document.getElementById(hintId);
            hint.classList.remove('hidden');
            setTimeout(() => hint.classList.add('hidden'), 2000);
        }

        document.addEventListener('DOMContentLoaded', function() {
            lucide.createIcons();
            connectFirebase();
        });

        function connectFirebase() {
            if (firebase.apps.length) firebase.apps.forEach(app => app.delete());
            try {
                firebase.initializeApp(defaultFirebaseConfig);
                db = firebase.firestore();

                firebase.auth().onAuthStateChanged(function(user) {
                    const loadingScreen = document.getElementById('login-loading-screen');
                    const loginForm = document.getElementById('admin-login-form');
                    
                    if (user) {
                        document.getElementById("user-profile").classList.remove("hidden");
                        document.getElementById("user-profile").classList.add("flex");
                        document.getElementById("user-avatar").src = user.photoURL || 'https://i.ibb.co/TDMwv5QD/Generated-Image-June052026-10-45-AM.jpg';
                        document.getElementById("user-name").innerText = user.displayName || 'Root Admin';

                        loadingScreen.classList.remove('hidden');
                        loginForm.classList.add('hidden');
                        
                        db.collection("users").limit(1).get().then(() => {
                            updateConnectionIndicator(true, defaultFirebaseConfig.projectId);
                            document.getElementById('step-setup').classList.add('hidden');
                            document.getElementById('admin-dashboard').classList.remove('hidden');
                            setupFirestoreRealtimeListeners();
                        }).catch(err => {
                            firebase.auth().signOut();
                            updateConnectionIndicator(false, 'Unauthorized');
                            document.getElementById("user-profile").classList.add("hidden");
                            alert("Access Denied: You are not an admin.");
                            location.reload();
                        });
                    } else {
                        loadingScreen.classList.add('hidden');
                        loginForm.classList.remove('hidden');
                        document.getElementById('step-setup').classList.remove('hidden');
                        document.getElementById('admin-dashboard').classList.add('hidden');
                        updateConnectionIndicator(false, 'Offline');
                    }
                });
            } catch (err) { console.error("Init error:", err); }
        }

        function handleGoogleLogin() {
            const provider = new firebase.auth.GoogleAuthProvider();
            firebase.auth().signInWithPopup(provider).catch(err => alert("Login Failed: " + err.message));
        }

        function handleAdminLogin(e) {
            e.preventDefault();
            const email = document.getElementById('login-email').value.trim();
            const password = document.getElementById('login-password').value;
            firebase.auth().signInWithEmailAndPassword(email, password).catch(err => alert("Login failed: " + err.message));
        }

        function updateConnectionIndicator(success, label) {
            const badge = document.getElementById('conn-badge');
            if (success) {
                badge.className = "flex items-center gap-2 bg-slate-900 border border-brand-success/20 rounded-xl px-4 py-2";
                badge.innerHTML = '<span class="w-2.5 h-2.5 bg-brand-success rounded-full animate-pulse"></span><span class="text-xs font-semibold text-brand-success">Database Online</span>';
            } else {
                badge.className = "flex items-center gap-2 bg-slate-900 border border-brand-error/20 rounded-xl px-4 py-2";
                badge.innerHTML = '<span class="w-2.5 h-2.5 bg-brand-error rounded-full"></span><span class="text-xs font-semibold text-brand-error">Offline</span>';
            }
        }

        function setupFirestoreRealtimeListeners() {
            // Config
            db.collection("config").doc("app").onSnapshot(doc => {
                if (doc && doc.exists) {
                    const data = doc.data();
                    document.getElementById('settings-maintenance').checked = data.isMaintenanceMode === true;
                    document.getElementById('settings-min-version').value = data.minAppVersionRequired || "1.0.0";
                    document.getElementById('settings-download-url').value = data.appDownloadUrl || "";
                    toggleLocalLockIndicator();
                }
            });

            // Users
            db.collection("users").onSnapshot(qs => {
                globalUsers = [];
                qs.forEach(doc => { const d = doc.data(); d.uid = doc.id; globalUsers.push(d); });
                document.getElementById('users-count-badge').innerText = globalUsers.length;
                rebuildCoreDiagnostics(); renderUsersTable(); lucide.createIcons();
            });

            // Transactions
            db.collection("transactions").onSnapshot(qs => {
                globalTransactions = [];
                qs.forEach(doc => { const d = doc.data(); d.doc_id = doc.id; globalTransactions.push(d); });
                document.getElementById('claims-count-badge').innerText = globalTransactions.filter(t => t.type === 'REDEEM' && t.status === 'PENDING').length;
                rebuildCoreDiagnostics(); renderClaimsTable(); lucide.createIcons();
            });

            // PubScale Webhooks (Real-time)
            db.collection("pubscale_callbacks").orderBy("created_at", "desc").limit(50).onSnapshot(qs => {
                globalWebhooks = [];
                qs.forEach(doc => globalWebhooks.push(doc.data()));
                renderWebhooksTable(); lucide.createIcons();
            });
        }

        function disconnectDb() { firebase.auth().signOut().then(() => location.reload()); }

        function switchTab(tabId) {
            document.querySelectorAll('.tab-pane').forEach(el => el.classList.add('hidden'));
            document.querySelectorAll('.tab-btn').forEach(btn => btn.className = "tab-btn px-6 py-4 text-sm font-bold flex items-center gap-2 border-b-2 border-transparent text-slate-400 hover:text-white transition whitespace-nowrap");
            document.getElementById(tabId).classList.remove('hidden');
            document.getElementById('btn-' + tabId).className = "tab-btn px-6 py-4 text-sm font-bold flex items-center gap-2 border-b-2 border-brand-accent text-white whitespace-nowrap";
        }

        function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
        function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

        function toggleLocalLockIndicator() {
            const badge = document.getElementById('badge-lock-status');
            if (document.getElementById('settings-maintenance').checked) {
                badge.className = "bg-brand-error/15 border border-brand-error/30 text-brand-error text-[9px] px-1.5 py-0.5 rounded uppercase font-extrabold";
                badge.innerText = "Active Locked";
            } else {
                badge.className = "bg-brand-success/15 border border-brand-success/30 text-brand-success text-[9px] px-1.5 py-0.5 rounded uppercase font-extrabold";
                badge.innerText = "Inactive";
            }
        }

        function rebuildCoreDiagnostics() {
            document.getElementById('stat-total-users').innerText = globalUsers.length;
            const totalCoins = globalUsers.reduce((sum, u) => sum + (parseInt(u.coins) || 0), 0);
            document.getElementById('stat-total-coins').innerText = totalCoins;
            const settled = globalTransactions.filter(t => t.type === 'REDEEM' && t.status === 'SUCCESS').reduce((sum, t) => sum + (parseInt(t.coinsAmount) || 0), 0);
            document.getElementById('stat-total-pro').innerText = "₹" + Math.floor(settled / 100);
            document.getElementById('stat-pending-claims').innerText = globalTransactions.filter(t => t.type === 'REDEEM' && t.status === 'PENDING').length;
        }

        function renderUsersTable() {
            const tbody = document.getElementById('users-table-rows');
            const searchVal = document.getElementById('user-filter').value.toLowerCase().trim();
            const filtered = globalUsers.filter(u => (u.displayName||"").toLowerCase().includes(searchVal) || (u.email||"").toLowerCase().includes(searchVal) || (u.uid||"").toLowerCase().includes(searchVal));
            
            if (filtered.length === 0) { tbody.innerHTML = '<tr><td colspan="5" class="py-12 text-center text-slate-500">No accounts found.</td></tr>'; return; }

            tbody.innerHTML = filtered.map(u => {
                const isBlocked = u.isBlocked === true;
                const statusHtml = isBlocked ? '<span class="bg-brand-error/15 text-brand-error border border-brand-error/20 text-[9px] px-2 py-0.5 font-extrabold rounded-md uppercase">Suspended</span>' : '<span class="bg-brand-success/15 text-brand-success border border-brand-success/20 text-[9px] px-2 py-0.5 font-extrabold rounded-md uppercase">Active</span>';
                const btnLabel = isBlocked ? "Lift BAN" : "Suspend";
                const btnClass = isBlocked ? "bg-slate-800 text-slate-300" : "bg-brand-error/10 text-brand-error";
                
                return '<tr class="hover:bg-slate-950/20 transition"><td class="px-6 py-4"><div class="flex items-center gap-3"><div class="w-9 h-9 bg-brand-accent/15 text-brand-accent font-extrabold rounded-xl flex items-center justify-center">' + (u.displayName||"U").charAt(0).toUpperCase() + '</div><div><h4 class="text-white font-bold">' + (u.displayName||"Unknown") + '</h4><p class="text-xs text-slate-400">' + (u.email||"No email") + '</p></div></div></td><td class="px-6 py-4.5"><p class="font-mono text-slate-400 font-bold text-xs">UID: ' + u.uid + '</p></td><td class="px-6 py-4.5 text-sm text-emerald-400 font-bold">' + (u.upiId || "Not Bound") + '</td><td class="px-6 py-4.5"><div class="flex items-center gap-2"><span class="text-white font-black text-sm">' + (u.coins||0) + '</span><button onclick="openCoinAdjustModal(\\'' + u.uid + '\\', \\'User\\')" class="p-1.5 bg-slate-800 text-slate-400 rounded-lg"><i data-lucide="plus-minus" class="w-3.5 h-3.5"></i></button></div></td><td class="px-6 py-4.5"><div class="flex items-center justify-end gap-2.5">' + statusHtml + '<button onclick="toggleUserSuspensionState(\\'' + u.uid + '\\', ' + isBlocked + ')" class="px-3 py-1.5 rounded-lg text-xs font-bold ' + btnClass + '">' + btnLabel + '</button></div></td></tr>';
            }).join('');
        }

        function renderClaimsTable() {
            const tbody = document.getElementById('claims-table-rows');
            const pending = globalTransactions.filter(t => t.type === 'REDEEM' && t.status === 'PENDING');
            if (pending.length === 0) { tbody.innerHTML = '<tr><td colspan="4" class="py-16 text-center text-slate-500">No pending claims.</td></tr>'; return; }

            tbody.innerHTML = pending.map(t => {
                const d = new Date(t.timestamp).toLocaleString();
                const upi = (t.details && t.details.includes('@')) ? t.details : "Unknown UPI";
                return '<tr class="hover:bg-slate-950/20 transition"><td class="px-6 py-5"><div class="flex items-center gap-3"><div class="w-9 h-9 bg-brand-warning/10 text-brand-warning rounded-xl flex items-center justify-center"><i data-lucide="shopping-bag" class="w-4.5 h-4.5"></i></div><div><h4 class="text-white font-bold">' + t.title + '</h4><p class="text-[11px] text-brand-warning">' + t.coinsAmount + ' Coins</p></div></div></td><td class="px-6 py-5"><h5 class="text-xs text-emerald-400 font-bold">' + upi + '</h5><p class="text-[10px] text-slate-500">' + t.uid + '</p></td><td class="px-6 py-5 text-xs text-slate-400">' + d + '</td><td class="px-6 py-5"><div class="flex items-center justify-center gap-2.5"><button onclick="openSettleClaimsModal(\\'' + t.doc_id + '\\', \\'Claim\\', \\'' + t.uid + '\\', ' + t.coinsAmount + ', true)" class="px-3.5 py-1.5 bg-slate-950 text-brand-success border border-brand-success/20 text-xs font-bold rounded-xl">Approve</button><button onclick="openSettleClaimsModal(\\'' + t.doc_id + '\\', \\'Claim\\', \\'' + t.uid + '\\', ' + t.coinsAmount + ', false)" class="px-3.5 py-1.5 bg-slate-950 text-brand-error border border-brand-error/20 text-xs font-bold rounded-xl">Reject</button></div></td></tr>';
            }).join('');
        }

        function renderWebhooksTable() {
            const tbody = document.getElementById('s2s-logs-table-rows');
            if (globalWebhooks.length === 0) { tbody.innerHTML = '<tr><td colspan="6" class="py-16 text-center text-slate-500">No webhook activity recorded yet.</td></tr>'; return; }

            tbody.innerHTML = globalWebhooks.map(item => {
                let badge = '<span class="text-brand-error bg-brand-error/10 px-2 py-0.5 rounded text-[10px] uppercase font-bold">Rejected</span>';
                if (item.verified && item.db_success) badge = '<span class="text-brand-success bg-brand-success/10 px-2 py-0.5 rounded text-[10px] uppercase font-bold">Success</span>';
                else if (item.verified && !item.db_success) badge = '<span class="text-brand-warning bg-brand-warning/10 px-2 py-0.5 rounded text-[10px] uppercase font-bold">DB Failed</span>';

                const verText = item.verified ? '<span class="text-brand-success">✓ Valid</span>' : '<span class="text-brand-error">✗ Invalid</span>';
                
                return '<tr class="hover:bg-slate-950/30 transition text-xs border-b border-brand-border/50"><td class="px-6 py-4 font-mono text-slate-400">' + (item.timestamp||"N/A") + '</td><td class="px-6 py-4 font-mono font-bold text-slate-300">' + (item.user_id||"N/A") + '</td><td class="px-6 py-4 text-brand-accent font-bold truncate max-w-[150px]">' + (item.token||"N/A") + '</td><td class="px-6 py-4">' + verText + '<br><span class="text-[9px] text-slate-500">' + (item.db_msg||"") + '</span></td><td class="px-6 py-4 font-black text-emerald-400">+' + (item.value||0) + ' Coins</td><td class="px-6 py-4">' + badge + '</td></tr>';
            }).join('');
        }

        function openCoinAdjustModal(uid, name) { activeCoinsUserUid = uid; openModal('modal-coin'); }
        function submitCoinAdjust(type) {
            const size = parseInt(document.getElementById('coin-change-num').value);
            if (isNaN(size) || size <= 0) return alert("Invalid amount");
            db.collection("users").doc(activeCoinsUserUid).get().then(doc => {
                if (doc.exists) {
                    const finalCoins = Math.max(0, (parseInt(doc.data().coins) || 0) + (type === 'add' ? size : -size));
                    doc.ref.update({ coins: finalCoins }).then(() => {
                        db.collection("transactions").doc(activeCoinsUserUid + '_' + Date.now()).set({ uid: activeCoinsUserUid, type: type === 'add' ? 'EARN' : 'REDEEM', title: 'Manual Adjust', coinsAmount: size, status: 'SUCCESS', timestamp: Date.now() }).then(() => { closeModal('modal-coin'); alert("Updated!"); });
                    });
                }
            });
        }

        function toggleUserSuspensionState(uid, isBlocked) {
            if (confirm("Change suspension status?")) db.collection("users").doc(uid).set({ isBlocked: !isBlocked }, { merge: true });
        }

        function openSettleClaimsModal(docId, title, uid, coins, isApprove) {
            activeSettleTxDocId = docId; activeCoinsAmount = coins;
            document.getElementById('settle-notes').value = isApprove ? "PAYOUT CLEARED" : "PAYOUT REJECTED";
            document.getElementById('btn-submit-approve').classList.toggle('hidden', !isApprove);
            document.getElementById('btn-submit-reject').classList.toggle('hidden', isApprove);
            document.getElementById('btn-submit-approve').onclick = () => commitPayout(uid, true);
            document.getElementById('btn-submit-reject').onclick = () => commitPayout(uid, false);
            openModal('modal-settle');
        }

        function commitPayout(uid, isApprove) {
            const status = isApprove ? "SUCCESS" : "REJECTED";
            const notes = document.getElementById('settle-notes').value;
            if (isApprove) {
                db.collection("transactions").doc(activeSettleTxDocId).update({ status: status, details: notes }).then(() => { closeModal('modal-settle'); alert("Settled!"); });
            } else {
                db.collection("users").doc(uid).get().then(doc => {
                    if (doc.exists) {
                        doc.ref.update({ coins: (parseInt(doc.data().coins) || 0) + activeCoinsAmount }).then(() => {
                            db.collection("transactions").doc(activeSettleTxDocId).update({ status: status, details: notes }).then(() => { closeModal('modal-settle'); alert("Rejected & Refunded!"); });
                        });
                    }
                });
            }
        }

        function saveMaintenanceLockState() {
            db.collection("config").doc("app").set({ isMaintenanceMode: document.getElementById('settings-maintenance').checked }, { merge: true }).then(() => alert("Saved!"));
        }

        function saveGlobalSettings() {
            db.collection("config").doc("app").set({ isMaintenanceMode: document.getElementById('settings-maintenance').checked, minAppVersionRequired: document.getElementById('settings-min-version').value, appDownloadUrl: document.getElementById('settings-download-url').value }, { merge: true }).then(() => alert("Saved!"));
        }
    </script>
</body>
</html>`;
}

// Vercel Serverless Function Endpoint
module.exports = async (req, res) => {
  // Dynamically get the domain for the webhook URL display
  const envDomain = req.headers['host'] || 'pubscale-webhook-vrewardx.vercel.app';
  
  // Generate the HTML
  const html = getDashboardHtml(envDomain);
  
  // Send the response instantly (No server-side database fetching needed, UI handles it real-time)
  res.setHeader('Content-Type', 'text/html');
  return res.status(200).send(html);
};
