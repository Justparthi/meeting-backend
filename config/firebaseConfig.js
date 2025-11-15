// server/config/firebaseConfig.js
const admin = require('firebase-admin');

// Initialize Firebase Admin
let serviceAccount;

try {
  // Try to load from environment variable first
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } else {
    // Fall back to local file
    serviceAccount = require('./serviceAccountKey.json');
  }
} catch (error) {
  console.error('❌ Firebase service account not found:', error.message);
  console.log('⚠️  Please add FIREBASE_SERVICE_ACCOUNT to your .env file or add serviceAccountKey.json');
}

if (!admin.apps.length && serviceAccount) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });
}

const db = admin.firestore();
const auth = admin.auth(); // Add Firebase Auth

module.exports = { 
  db, 
  auth,
  admin 
};