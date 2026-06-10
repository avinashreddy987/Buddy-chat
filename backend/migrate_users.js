/*
  Backfill users collection: set authProvider to "local" for legacy users
  Usage: node backend/migrate_users.js
*/
const { MongoClient } = require('mongodb');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
const MONGODB_DB = process.env.MONGODB_DB || 'chatbot';

async function run() {
  if (!MONGODB_URI) {
    console.error('MONGODB_URI not set. Set environment or .env file.');
    process.exit(1);
  }

  const client = new MongoClient(MONGODB_URI, { serverApi: { version: '1' } });
  try {
    await client.connect();
    const db = client.db(MONGODB_DB);
    const users = db.collection('users');

    // Update documents that are missing authProvider
    const res = await users.updateMany(
      { $or: [{ authProvider: { $exists: false } }, { authProvider: null }] },
      { $set: { authProvider: 'local' }, $currentDate: { lastSeen: true } }
    );

    console.log(`Matched ${res.matchedCount}, modified ${res.modifiedCount} documents.`);
  } catch (err) {
    console.error('Migration failed:', err && err.message ? err.message : err);
    process.exit(2);
  } finally {
    await client.close();
  }
}

run();
