const { db } = require('../config/firebaseConfig');

const Meeting = {
  async create(data) {
    const meeting = {
      roomCode: data.roomCode,
      meetingId: data.meetingId,
      roomName: data.roomName,
      hostUserId: data.hostUserId,
      hostName: data.hostName,
      participants: data.participants || [],
      settings: data.settings || {},
      isActive: true,
      startTime: new Date(),
      isInstant: data.isInstant || false,
      createdAt: new Date(),
    };
    await db.collection('meetings').add(meeting);
  },

  async getByRoomCode(roomCode) {
    const snapshot = await db
      .collection('meetings')
      .where('roomCode', '==', roomCode)
      .get();

    return snapshot.empty ? null : { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
  },

  async update(meetingId, data) {
    await db.collection('meetings').doc(meetingId).update(data);
  },
};

module.exports = Meeting;
