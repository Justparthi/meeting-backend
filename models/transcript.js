// server/routes/transcripts.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');

// Initialize Firebase Admin if not already initialized
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });
}

const db = admin.database();

/**
 * POST /api/transcripts/save
 * Save transcripts to Firebase Realtime Database
 */
router.post('/save', async (req, res) => {
  try {
    console.log('📝 Received transcript save request');
    
    const { roomId, userName, transcripts, duration, createdAt } = req.body;

    // Validate required fields
    if (!roomId) {
      return res.status(400).json({
        success: false,
        error: 'roomId is required'
      });
    }

    if (!transcripts || !Array.isArray(transcripts)) {
      return res.status(400).json({
        success: false,
        error: 'transcripts array is required'
      });
    }

    console.log(`💾 Saving ${transcripts.length} transcripts for room ${roomId}`);

    // Generate a unique transcript batch ID
    const transcriptBatchId = `transcript_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Prepare transcript data
    const transcriptData = {
      roomId,
      userName: userName || 'Unknown User',
      transcripts: transcripts.map((t, index) => ({
        id: `${transcriptBatchId}_${index}`,
        speaker: t.speaker,
        text: t.text,
        timestamp: t.timestamp || new Date().toISOString(),
        order: index
      })),
      duration: duration || 0,
      createdAt: createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      transcriptCount: transcripts.length
    };

    // Save to Firebase under /transcripts/{roomId}/{transcriptBatchId}
    const transcriptRef = db.ref(`transcripts/${roomId}/${transcriptBatchId}`);
    await transcriptRef.set(transcriptData);

    // Also update the room's transcript metadata
    const roomTranscriptMetaRef = db.ref(`rooms/${roomId}/transcriptMetadata`);
    await roomTranscriptMetaRef.update({
      lastTranscriptBatchId: transcriptBatchId,
      lastTranscriptTime: new Date().toISOString(),
      totalTranscripts: admin.database.ServerValue.increment(transcripts.length),
      hasTranscripts: true
    });

    console.log('✅ Transcripts saved successfully:', transcriptBatchId);

    res.json({
      success: true,
      message: 'Transcripts saved successfully',
      transcriptId: transcriptBatchId,
      transcriptCount: transcripts.length,
      roomId: roomId
    });

  } catch (error) {
    console.error('❌ Error saving transcripts:', error);
    
    res.status(500).json({
      success: false,
      error: 'Failed to save transcripts',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * GET /api/transcripts/:roomId
 * Retrieve all transcripts for a room
 */
router.get('/:roomId', async (req, res) => {
  try {
    const { roomId } = req.params;
    
    console.log(`📖 Fetching transcripts for room: ${roomId}`);

    const transcriptsRef = db.ref(`transcripts/${roomId}`);
    const snapshot = await transcriptsRef.once('value');
    
    if (!snapshot.exists()) {
      return res.json({
        success: true,
        transcripts: [],
        message: 'No transcripts found for this room'
      });
    }

    const transcriptsData = snapshot.val();
    
    // Convert object to array and flatten transcripts
    const allTranscripts = [];
    Object.values(transcriptsData).forEach(batch => {
      if (batch.transcripts && Array.isArray(batch.transcripts)) {
        allTranscripts.push(...batch.transcripts.map(t => ({
          ...t,
          batchCreatedAt: batch.createdAt,
          userName: batch.userName
        })));
      }
    });

    // Sort by timestamp
    allTranscripts.sort((a, b) => 
      new Date(a.timestamp) - new Date(b.timestamp)
    );

    console.log(`✅ Found ${allTranscripts.length} transcripts`);

    res.json({
      success: true,
      transcripts: allTranscripts,
      totalCount: allTranscripts.length,
      roomId: roomId
    });

  } catch (error) {
    console.error('❌ Error fetching transcripts:', error);
    
    res.status(500).json({
      success: false,
      error: 'Failed to fetch transcripts',
      message: error.message
    });
  }
});

/**
 * DELETE /api/transcripts/:roomId
 * Delete all transcripts for a room
 */
router.delete('/:roomId', async (req, res) => {
  try {
    const { roomId } = req.params;
    
    console.log(`🗑️ Deleting transcripts for room: ${roomId}`);

    const transcriptsRef = db.ref(`transcripts/${roomId}`);
    await transcriptsRef.remove();

    // Update room metadata
    const roomTranscriptMetaRef = db.ref(`rooms/${roomId}/transcriptMetadata`);
    await roomTranscriptMetaRef.update({
      hasTranscripts: false,
      totalTranscripts: 0,
      lastDeletedAt: new Date().toISOString()
    });

    console.log('✅ Transcripts deleted successfully');

    res.json({
      success: true,
      message: 'Transcripts deleted successfully',
      roomId: roomId
    });

  } catch (error) {
    console.error('❌ Error deleting transcripts:', error);
    
    res.status(500).json({
      success: false,
      error: 'Failed to delete transcripts',
      message: error.message
    });
  }
});

/**
 * GET /api/transcripts/:roomId/export
 * Export transcripts as formatted text
 */
router.get('/:roomId/export', async (req, res) => {
  try {
    const { roomId } = req.params;
    const { format = 'txt' } = req.query;
    
    console.log(`📤 Exporting transcripts for room: ${roomId} as ${format}`);

    const transcriptsRef = db.ref(`transcripts/${roomId}`);
    const snapshot = await transcriptsRef.once('value');
    
    if (!snapshot.exists()) {
      return res.status(404).json({
        success: false,
        error: 'No transcripts found for this room'
      });
    }

    const transcriptsData = snapshot.val();
    
    // Flatten and sort transcripts
    const allTranscripts = [];
    Object.values(transcriptsData).forEach(batch => {
      if (batch.transcripts && Array.isArray(batch.transcripts)) {
        allTranscripts.push(...batch.transcripts);
      }
    });

    allTranscripts.sort((a, b) => 
      new Date(a.timestamp) - new Date(b.timestamp)
    );

    if (format === 'json') {
      res.json({
        success: true,
        roomId,
        transcripts: allTranscripts,
        exportedAt: new Date().toISOString()
      });
    } else {
      // Format as text
      const text = [
        `Meeting Transcript - Room ${roomId}`,
        `Exported: ${new Date().toLocaleString()}`,
        `Total Messages: ${allTranscripts.length}`,
        '─'.repeat(80),
        '',
        ...allTranscripts.map(t => {
          const time = new Date(t.timestamp).toLocaleTimeString();
          return `[${time}] ${t.speaker}: ${t.text}`;
        })
      ].join('\n');

      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Content-Disposition', `attachment; filename="transcript-${roomId}.txt"`);
      res.send(text);
    }

  } catch (error) {
    console.error('❌ Error exporting transcripts:', error);
    
    res.status(500).json({
      success: false,
      error: 'Failed to export transcripts',
      message: error.message
    });
  }
});

module.exports = router;