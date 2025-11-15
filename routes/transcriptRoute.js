// server/routes/transcriptRoute.js
const express = require('express');
const router = express.Router();
const { db } = require('../config/firebaseConfig');

/**
 * POST /api/transcripts/save
 * Save individual transcript entries to Firebase
 * Simple approach: Each transcript is stored separately with timestamp and speaker
 */
router.post('/save', async (req, res) => {
  try {
    console.log('📝 Received transcript save request');
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    
    const { roomId, userName, transcripts } = req.body;

    // Validate required fields
    if (!roomId) {
      console.error('❌ Validation error: roomId is required');
      return res.status(400).json({
        success: false,
        error: 'roomId is required'
      });
    }

    if (!transcripts || !Array.isArray(transcripts)) {
      console.error('❌ Validation error: transcripts array is required');
      return res.status(400).json({
        success: false,
        error: 'transcripts array is required'
      });
    }

    if (transcripts.length === 0) {
      console.log('⚠️ No transcripts to save (empty array)');
      return res.json({
        success: true,
        message: 'No transcripts to save',
        savedCount: 0
      });
    }

    console.log(`💾 Saving ${transcripts.length} transcript entries for room ${roomId}`);

    // Store each transcript as a separate entry
    const transcriptPromises = transcripts.map(async (transcript) => {
      // Generate unique ID for each transcript entry
      const transcriptId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const transcriptEntry = {
        id: transcriptId,
        roomId: roomId,
        speaker: transcript.speaker || userName || 'Unknown',
        text: transcript.text || '',
        timestamp: transcript.timestamp || new Date().toISOString(),
        createdAt: new Date().toISOString()
      };

      // Save to /transcripts/{roomId}/{transcriptId}
      const transcriptRef = db.ref(`transcripts/${roomId}/${transcriptId}`);
      return transcriptRef.set(transcriptEntry);
    });

    // Wait for all transcripts to be saved
    await Promise.all(transcriptPromises);
    
    console.log(`✅ Successfully saved ${transcripts.length} transcript entries`);

    res.json({
      success: true,
      message: 'Transcripts saved successfully',
      savedCount: transcripts.length,
      roomId: roomId
    });

  } catch (error) {
    console.error('❌ Error saving transcripts:', error);
    console.error('Error stack:', error.stack);
    
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
    
    // Convert object to array
    const transcriptsArray = Object.values(transcriptsData);

    // Sort by timestamp
    transcriptsArray.sort((a, b) => 
      new Date(a.timestamp) - new Date(b.timestamp)
    );

    console.log(`✅ Found ${transcriptsArray.length} transcripts`);

    res.json({
      success: true,
      transcripts: transcriptsArray,
      totalCount: transcriptsArray.length,
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
 * Export transcripts as formatted text or JSON
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
    const transcriptsArray = Object.values(transcriptsData);

    // Sort by timestamp
    transcriptsArray.sort((a, b) => 
      new Date(a.timestamp) - new Date(b.timestamp)
    );

    if (format === 'json') {
      res.json({
        success: true,
        roomId,
        transcripts: transcriptsArray,
        exportedAt: new Date().toISOString()
      });
    } else {
      // Format as text
      const text = [
        `Meeting Transcript - Room ${roomId}`,
        `Exported: ${new Date().toLocaleString()}`,
        `Total Messages: ${transcriptsArray.length}`,
        '─'.repeat(80),
        '',
        ...transcriptsArray.map(t => {
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

/**
 * GET /api/transcripts/health
 * Health check endpoint
 */
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Transcript service is running',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;