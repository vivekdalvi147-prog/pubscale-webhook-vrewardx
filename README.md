# vRewardX Webhook Node.js Backend (Vercel) 🚀

Yeh aapka **Node.js Backend Server** hai jo S2S (Server-to-Server) callbacks receive, validate, aur process karke PubScale / GreedyGame Offerwall se **User Real Coins** update karne me help karega. Isme built-in **Real-Time Log Dashboard** bhi hai jo aap open karke easily verified, pending aur complete transactions live monitor kar sakte hain!

---

## 📂 Project Structure

Is folder ke andar ye sab files bani hui hain jo Vercel deployment ke liye fully-optimized hain:
1. **`api/callback.js`**: Core S2S callback receiver and verifier.
2. **`api/index.js`**: Web Activity Dashboard connected to Firestore.
3. **`vercel.json`**: Vercel Routing system configuration.
4. **`package.json`**: Dependencies definition (`firebase-admin`).

---

## ⚡ Deployment on Vercel

Aap is server ko Vercel par **2 minutes** me deploy kar sakte hain:

1. Apne GitHub account par ek naya repository banayein (Jaise: `pubscale-webhook-vrewardx`).
2. Is `/backend_server` folder ke andar ki sabhi files ko us repository me push kar dein:
   ```bash
   git init
   git add .
   git commit -m "Deploy vRewardX JS webhook server with Firebase Firestore"
   git remote add origin <your-github-repo-url>
   git branch -M main
   git push -u origin main
   ```
3. Apne [Vercel Dashboard](https://vercel.com/) par jayein, **Add New Project** click karein aur apne is git repo ko select karke **Deploy** button dabaein!

---

## 🔒 Configuration & Environment Variables

Aapko Vercel ke **Environment Variables** panel me ye key-values add karni hain. Isme aapko JSON files paste karne ki koi jhanjhat nahi hai kyunkin humne isko pure individual variables me break kar diya hai taki koi error na aaye:

### 1. PubScale S2S Secret Key:
* **Key**: `PUBSCALE_S2S_SECRET`
* **Value**: *Aapke PubScale App Dashboard ke S2S Callback option me jo Secret Key (e.g. jo "6f9c" par end ho rahi hai) likhi hai, usey exact copy karke yahan paste karein.*

### 2. Firebase Connection (Vip Setup):
Agar aap standard multiline JSON file ko directly paste karte hain, to Vercel support nahi kar pata aur syntax error de deta hai. Isliye is server me humne isko piece-by-piece accept karne ka automatic safe logic build kiya hai:

1. **`FIREBASE_PROJECT_ID`**: `vrewardx`
2. **`FIREBASE_CLIENT_EMAIL`**: `firebase-adminsdk-fbsvc@vrewardx.iam.gserviceaccount.com`
3. **`FIREBASE_PRIVATE_KEY`**: *Aapke Service Account key file ka pura value (starting with `-----BEGIN PRIVATE KEY-----` and ending with `-----END PRIVATE KEY-----` including all lines & dashes).*

---

## 🛠️ PubScale Me Callback Setup Kaise Karein?

Vercel deployment hone ke baad aapko ek live URL milegi:
`https://your-app-name.vercel.app/`

Apne PubScale Web Account me callback setting me jayein aur wahan ye enter karein:
* **Base Callback URL**: `https://your-app-name.vercel.app/api/callback`
* **Request Method**: `GET`
* **Parameters Config**:
  - `user_id`: `{user_id}`
  - `value`: `{value}`
  - `token`: `{token}`
  - `signature`: `{signature}`

---

## 💡 Why did the 403 Error Happen? (S2S Secret Logic)
PubScale integration rules ke mutabik:
- S2S callbacks verify karne ke liye signature banaya jata hai.
- PubScale standard verification signature formula use karta hai: `{secret_key}.{user_id}.{value_int}.{token}`.
- Is signature me decimal values ko integer format me convert karna compulsory hota hai (Jaise `1` or `100.1234` ko standard math convert karke hum Node.js internal code me automatically `Math.floor(value)` handle karte hain).
- Jab aapka server response aur hashes verify nahi hote, to PubScale system callback validation level par direct HTTP 403 Blocked status register karta hai.
- Humne logic me dotted formula implementations verify kiye hain jo dynamic calculations instantly matching karenge!

---

## 📊 Live Monitoring Dashboard
Deployment ke baad jab aap project URL (Matlab root: `https://your-app-name.vercel.app/`) ko web browser me open karenge, tab aapko ek sleek visual system console load hoga jahan live callbacks stream, timestamps, aur verified states real-time updates dikhayenge (Directly connected to Firestore persistent logging).

Happy Earning with **vRewardX!** 👑
