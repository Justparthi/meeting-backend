// server/test-transcript-api.js
// Run this script to test the transcript API directly
// Usage: node test-transcript-api.js

const fetch = require('node-fetch');

const TEST_DATA = {
  roomId: 'TEST_ROOM_123',
  userName: 'Test User',
  transcripts: [
    {
      speaker: 'Test User',
      text: 'Hello, this is a test transcript',
      timestamp: new Date().toISOString()
    },
    {
      speaker: 'Test User',
      text: 'Second test message',
      timestamp: new Date().toISOString()
    }
  ],
  duration: 10,
  createdAt: new Date().toISOString()
};

async function testTranscriptAPI() {
  console.log('🧪 Testing Transcript API\n');
  console.log('📦 Test Data:', JSON.stringify(TEST_DATA, null, 2));
  console.log('\n');

  try {
    const serverUrl = 'http://localhost:3001';
    
    // Test 1: Health Check
    console.log('1️⃣ Testing health endpoint...');
    try {
      const healthResponse = await fetch(`${serverUrl}/api/transcripts/health`);
      const healthData = await healthResponse.json();
      console.log('✅ Health check passed:', healthData);
    } catch (error) {
      console.error('❌ Health check failed:', error.message);
      console.error('⚠️ Make sure the server is running on port 3001');
      return;
    }
    console.log('\n');

    // Test 2: Save Transcript
    console.log('2️⃣ Testing save transcript...');
    try {
      const saveResponse = await fetch(`${serverUrl}/api/transcripts/save`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(TEST_DATA)
      });

      console.log('Response Status:', saveResponse.status);
      console.log('Response Headers:', saveResponse.headers.raw());

      if (!saveResponse.ok) {
        const errorText = await saveResponse.text();
        console.error('❌ Save failed with status:', saveResponse.status);
        console.error('Error response:', errorText);
        return;
      }

      const saveData = await saveResponse.json();
      console.log('✅ Save succeeded:', JSON.stringify(saveData, null, 2));
      console.log('\n');

      // Test 3: Retrieve Transcript
      console.log('3️⃣ Testing retrieve transcript...');
      const retrieveResponse = await fetch(`${serverUrl}/api/transcripts/${TEST_DATA.roomId}`);
      const retrieveData = await retrieveResponse.json();
      console.log('✅ Retrieved transcripts:', JSON.stringify(retrieveData, null, 2));
      console.log('\n');

      // Test 4: Delete Transcript
      console.log('4️⃣ Testing delete transcript...');
      const deleteResponse = await fetch(`${serverUrl}/api/transcripts/${TEST_DATA.roomId}`, {
        method: 'DELETE'
      });
      const deleteData = await deleteResponse.json();
      console.log('✅ Delete succeeded:', JSON.stringify(deleteData, null, 2));

    } catch (error) {
      console.error('❌ Test failed:', error.message);
      console.error('Stack:', error.stack);
    }

    console.log('\n✅ All tests completed!\n');

  } catch (error) {
    console.error('❌ Test suite failed:', error.message);
    console.error('Stack:', error.stack);
  }
}

// Run tests
testTranscriptAPI().catch(console.error);