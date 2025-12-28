// --- CLEANUP SCRIPT: Delete Old Migration Collections ---
// This script deletes /ships, /visits_new, and /trips collections
// to prepare for a fresh migration run.

const admin = require('firebase-admin');

// 🔐 Using the same service account key as migrate.js
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: 'shannonpilots-6fedd'
});

const db = admin.firestore();

// Collections to delete
const COLLECTIONS_TO_DELETE = ['ships', 'visits_new', 'trips'];

/**
 * Deletes all documents in a collection using batched writes.
 * Why batched? Firestore limits us to 500 operations per batch,
 * so we delete in chunks to avoid hitting the limit.
 */
async function deleteCollection(collectionName) {
    const collectionRef = db.collection(collectionName);
    const batchSize = 200; // Conservative batch size to stay well under 500 limit
    
    console.log(`\n🗑️  Deleting collection: /${collectionName}`);
    
    let deletedCount = 0;
    
    while (true) {
        // Query for documents to delete (limit to batch size)
        const snapshot = await collectionRef.limit(batchSize).get();
        
        if (snapshot.empty) {
            console.log(`   ✅ Deleted ${deletedCount} documents from /${collectionName}`);
            break;
        }
        
        // Create a batch to delete documents
        const batch = db.batch();
        snapshot.docs.forEach((doc) => {
            batch.delete(doc.ref);
        });
        
        // Commit the batch
        await batch.commit();
        deletedCount += snapshot.size;
        
        console.log(`   ⏳ Deleted ${deletedCount} documents so far...`);
    }
}

/**
 * Main cleanup function
 */
async function runCleanup() {
    console.log('🚀 Starting cleanup of old migration data...');
    console.log('📋 Collections to delete:', COLLECTIONS_TO_DELETE.join(', '));
    
    try {
        // Delete each collection sequentially
        for (const collectionName of COLLECTIONS_TO_DELETE) {
            await deleteCollection(collectionName);
        }
        
        console.log('\n🎉 CLEANUP SUCCESSFUL!');
        console.log('✅ Old migration data has been deleted.');
        console.log('✅ Ready to run: node migrate.js');
        
    } catch (error) {
        console.error('\n🛑 ERROR during cleanup:', error);
        process.exit(1);
    }
    
    process.exit(0);
}

runCleanup();
