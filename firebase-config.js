// ─────────────────────────────────────────────────────────────────────────────
// SKETCHBRIDGE — Firebase Configuration
// ─────────────────────────────────────────────────────────────────────────────
// HOW TO FILL THIS FILE:
//  1. Go to https://console.firebase.google.com
//  2. Create a project (free Spark plan)
//  3. Click "Add app" → Web → Register app
//  4. Copy the firebaseConfig object shown and paste the values below
//  5. In Firebase console → Build → Realtime Database → Create database
//     → Start in test mode → choose any region → Done
// ─────────────────────────────────────────────────────────────────────────────

const FIREBASE_CONFIG = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL:       "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID"
};

// ─────────────────────────────────────────────────────────────────────────────
// Room auto-clear: strokes older than 24 hours are removed by the client.
// No cloud functions needed — pure client-side cleanup on room join.
// ─────────────────────────────────────────────────────────────────────────────
const ROOM_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
