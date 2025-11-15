const { db } = require('../config/firebaseConfig');

const ChatMessage = {
  async create({ roomId, userId, userName, message, type = 'text' }) {
    await db.collection('chatMessages').add({
      roomId,
      userId,
      userName,
      message,
      type,
      timestamp: new Date(),
    });
  },

  async getByRoom(roomId) {
    const snapshot = await db
      .collection('chatMessages')
      .where('roomId', '==', roomId)
      .orderBy('timestamp', 'desc')
      .get();

    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  },
};

module.exports = ChatMessage;
