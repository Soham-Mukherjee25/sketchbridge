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
  apiKey:            "AIzaSyD59tTVIuYktmJvaTPLmLjgd_lxlTjxQpU",
  authDomain:        "sketchbridge-39df2.firebaseapp.com",
  databaseURL:       "https://sketchbridge-39df2-default-rtdb.firebaseio.com",  // ← add this
  projectId:         "sketchbridge-39df2",
  storageBucket:     "sketchbridge-39df2.firebasestorage.app",
  messagingSenderId: "1089242803227",
  appId:             "1:1089242803227:web:300e67aa6ce18f4bbb9cbe"
};

const ROOM_EXPIRY_MS = 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// Room auto-clear: strokes older than 24 hours are removed by the client.
// No cloud functions needed — pure client-side cleanup on room join.
// ─────────────────────────────────────────────────────────────────────────────
const ROOM_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
