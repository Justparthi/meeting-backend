const { db } = require('./config/firebaseConfig');

async function testConnection() {
  try {
    const testRef = db.collection('test');
    await testRef.add({ message: 'Hello Firebase!', timestamp: new Date() });
    console.log('✅ Successfully wrote to Firestore!');

    const snapshot = await testRef.get();
    snapshot.forEach(doc => console.log('📄', doc.id, doc.data()));
  } catch (error) {
    console.error('❌ Firestore test failed:', error);
  }
}

testConnection();
