# Migration Script - Secure Authentication

## What It Does

This script migrates data from the old `/visits` collection to the new normalized structure:

- **Reads from** (READ ONLY): `/visits` - Original data is NOT modified
- **Writes to**: `/ships`, `/visits_new`, `/trips`

### Key Features

✅ **Ship Deduplication**: Creates unique ships by IMO or name  
✅ **Pilot Reassignment**: Updates pilots based on date cutoffs  
✅ **Single Port Field**: Uses new data model with `port` instead of `fromPort`/`toPort`  
✅ **Batch Processing**: Handles large datasets efficiently  
✅ **Secure Authentication**: No credential files needed!

## Prerequisites

### 1. Firebase CLI Authentication (Recommended)

```bash
# Install Firebase CLI globally
npm install -g firebase-tools

# Login with your Firebase account
firebase login
```

### 2. Install Dependencies

```bash
npm install firebase-admin
```

## Running the Migration

```bash
cd scripts
node migrate.js
```

The script will use your Firebase CLI login credentials automatically - **no service account file needed!**

## Alternative: Environment Variable (If Firebase CLI doesn't work)

If you prefer or Firebase CLI authentication doesn't work:

1. Download service account key from Firebase Console
2. Set environment variable:

**Windows (PowerShell):**

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS="C:\path\to\service-account.json"
node migrate.js
```

**Mac/Linux:**

```bash
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account.json"
node migrate.js
```

## What You'll See

```
✅ Firebase Admin initialized with Application Default Credentials
🚀 Starting data migration...
📖 Reading from: /visits (READ ONLY)
✍️  Writing to: /ships, /visits_new, /trips

Found 42 old visit documents to process.
   Pilot reassigned: Fergal -> Will for Visit abc123
   ⏳ Committing batch of 490 operations...

🎉 MIGRATION SUCCESSFUL!
Total Ships created/updated: 23
All 42 visits migrated.

✅ /visits collection was NOT modified (read-only)
✅ New data created in: /ships, /visits_new, /trips
```

## Security Benefits

✅ **No credentials in files**: Uses your Firebase CLI session  
✅ **No accidental commits**: No service account JSON in your repo  
✅ **Easier setup**: Just login with Firebase CLI

## Troubleshooting

**Error: "Failed to initialize Firebase Admin"**

- Run `firebase login` first
- Or set `GOOGLE_APPLICATION_CREDENTIALS` environment variable

**Error: "Permission denied"**

- Ensure your Firebase account has Firestore read/write permissions
