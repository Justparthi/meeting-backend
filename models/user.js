const { db } = require('../config/firebaseConfig');

const User = {
  async createOrUpdate(userData) {
    const snapshot = await db
      .collection('users')
      .where('userId', '==', userData.userId)
      .get();

    if (snapshot.empty) {
      await db.collection('users').add({
        ...userData,
        userName: userData.userName || 'Anonymous User',
        lastActive: new Date(),
        meetingsHosted: 0,
        meetingsJoined: 0,
        totalMinutes: 0,
        createdAt: new Date(),
      });
    } else {
      await db.collection('users')
        .doc(snapshot.docs[0].id)
        .update({ lastActive: new Date() });
    }
  },

  async getById(userId) {
    const snapshot = await db
      .collection('users')
      .where('userId', '==', userId)
      .get();

    return snapshot.empty ? null : { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
  },
};

module.exports = User;
