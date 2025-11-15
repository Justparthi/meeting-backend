const mongoose = require('mongoose');
require('dotenv').config({ path: './config.env' });

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log(`📊 Mongoose connected to MongoDB`);
    console.log(`✅ MongoDB Atlas connected successfully!`);
    console.log(`📍 Database: ${conn.connection.name}`);
    return conn;
  } catch (error) {
    console.error('Database connection error:', error);
    process.exit(1);
  }
};

const clearOldMeetings = async () => {
  try {
    await connectDB();
    
    // Get the meetings collection
    const db = mongoose.connection.db;
    const meetingsCollection = db.collection('meetings');
    
    // Delete all meetings with old schema (those with roomId field)
    const result = await meetingsCollection.deleteMany({ roomId: { $exists: true } });
    
    console.log(`🗑️ Deleted ${result.deletedCount} old meetings with roomId field`);
    
    // Also delete any meetings without roomCode
    const result2 = await meetingsCollection.deleteMany({ roomCode: { $exists: false } });
    
    console.log(`🗑️ Deleted ${result2.deletedCount} meetings without roomCode field`);
    
    console.log('✅ Database cleanup completed');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Database cleanup failed:', error);
    process.exit(1);
  }
};

clearOldMeetings();
