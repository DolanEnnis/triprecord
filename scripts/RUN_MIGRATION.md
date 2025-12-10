# 🚀 Ready to Run Migration

## Step 1: Download Service Account Key

1. Open [Firebase Console](https://console.firebase.google.com/)
2. Select your project: **ShannonPilots**
3. Go to **Project Settings** (⚙️ gear icon)
4. Click **Service Accounts** tab
5. Click **"Generate New Private Key"** button
6. Click **"Generate Key"** to confirm
7. Save the downloaded JSON file as:
   ```
   c:\Users\Admin\WebstormProjects\triprecord\scripts\serviceAccountKey.json
   ```

## Step 2: Run Migration

```powershell
cd c:\Users\Admin\WebstormProjects\triprecord\scripts
node migrate.js
```

## Step 3: Delete Service Account File

**IMMEDIATELY after migration completes:**

```powershell
Remove-Item serviceAccountKey.json
```

---

## What the Migration Does

✅ **Reads** from `/visits` (read-only, won't modify it)  
✅ **Creates** `/ships` (deduplicated by ship name/IMO)  
✅ **Creates** `/visits_new` (visit status and metadata)  
✅ **Creates** `/trips` (Inward + Outward trips with **single `port` field**)  
✅ **Reassigns pilots** (Fergal→Will, Fintan→Matt based on dates)

---

**Ready?** Download the key, save it, and run `node migrate.js`!
