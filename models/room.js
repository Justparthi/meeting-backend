const { db } = require('../config/firebaseConfig');

const Room = {
  async create({ roomId, name, host }) {
    await db.collection('rooms').add({
      roomId,
      name,
      host,
      createdAt: new Date(),
      isActive: true,
    });
  },

  async getById(roomId) {
    const snapshot = await db
      .collection('rooms')
      .where('roomId', '==', roomId)
      .get();

    return snapshot.empty ? null : { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
  },
};

module.exports = Room;
