// server/routes/claudeRoutes.js
const express = require('express');
const router = express.Router();

/**
 * POST /api/claude/summarize
 * Proxy endpoint for Claude API to avoid CORS issues
 */
router.post('/summarize', async (req, res) => {
  try {
    const { transcript } = req.body;

    if (!transcript) {
      return res.status(400).json({
        success: false,
        message: 'Transcript is required'
      });
    }

    console.log('🤖 Calling Claude API for summarization...');

    // Get API key from environment variable
    const apiKey = process.env.ANTHROPIC_API_KEY;
    
    if (!apiKey) {
      console.error('❌ ANTHROPIC_API_KEY not found in environment variables');
      return res.status(500).json({
        success: false,
        message: 'API key not configured'
      });
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [
          {
            role: "user",
            content: `Please provide a concise summary of this meeting transcript. Focus on key points, decisions made, and action items. Format the summary in clear paragraphs.

Transcript:
${transcript}

Provide a well-structured summary that captures the essence of the conversation.`
          }
        ],
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('❌ Claude API error:', response.status, errorData);
      throw new Error(`Claude API error: ${response.status}`);
    }

    const data = await response.json();
    const summary = data.content
      .filter(item => item.type === "text")
      .map(item => item.text)
      .join('\n');

    console.log('✅ Summary generated successfully');

    res.status(200).json({
      success: true,
      summary: summary
    });

  } catch (error) {
    console.error('❌ Error in Claude API proxy:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate summary',
      error: error.message
    });
  }
});

module.exports = router;