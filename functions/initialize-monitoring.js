// One-time script to initialize Firestore documents for Shannon monitoring
// Run this once with: node initialize-monitoring.js

const admin = require('firebase-admin');

// Initialize Firebase Admin (uses your local credentials)
admin.initializeApp();

const db = admin.firestore();

async function initializeMonitoring() {
  try {
    console.log('Creating system_settings/shannon_diary_metadata document...');
    
    await db.doc('system_settings/shannon_diary_metadata').set({
      update_available: false,
      processing: false,
      processing_started_at: null,
      current_last_modified: '',
      last_check: null,
      last_processed: null,
      watchtower_enabled: true
    });
    
    console.log('✓ Document created successfully!');
    console.log('\nYou can now:');
    console.log('1. Refresh the admin page to see the monitoring dashboard');
    console.log('2. Visit Sheet-Info page to trigger the first PDF fetch');
    console.log('3. Watchtower functions will run on schedule and update the document');
    
    process.exit(0);
  } catch (error) {
    console.error('Error creating document:', error);
    process.exit(1);
  }
}

initializeMonitoring();
