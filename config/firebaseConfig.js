const admin = require('firebase-admin');

let db;

try {
  // Handle Railway environment variable format
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;
  
  if (privateKey) {
    // Replace escaped newlines with actual newlines
    privateKey = privateKey.replace(/\\n/g, '\n');
  }

  if (!process.env.FIREBASE_PROJECT_ID || !privateKey || !process.env.FIREBASE_CLIENT_EMAIL) {
    throw new Error('Missing Firebase environment variables');
  }

  const serviceAccount = {
    type: "service_account",
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key: privateKey,
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
  };

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });

  db = admin.firestore();
  console.log('✅ Firebase initialized successfully');
} catch (error) {
  console.error('❌ Firebase initialization failed:', error.message);
  console.error('Continuing with in-memory storage only');
  db = null;
}

module.exports = { db, admin };