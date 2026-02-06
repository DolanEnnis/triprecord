"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onShipUpdated = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");
const firestore_2 = require("firebase-admin/firestore");
/**
 * Triggered when a ship's details (Name or GT) are updated.
 * Propagates these changes to:
 * 1. Active Visits (Due, Awaiting Berth, Alongside)
 * 2. Recent Visits (last 60 days)
 * 3. Recent Trips (last 60 days) - CRITICAL for billing
 *
 * @audit-trail Sets updatedBy='System (Ship Update)'
 */
exports.onShipUpdated = (0, firestore_1.onDocumentUpdated)("ships/{shipId}", async (event) => {
    var _a, _b;
    const shipId = event.params.shipId;
    const oldShip = (_a = event.data) === null || _a === void 0 ? void 0 : _a.before.data();
    const newShip = (_b = event.data) === null || _b === void 0 ? void 0 : _b.after.data();
    // 1. Safety Checks
    if (!oldShip || !newShip)
        return;
    // 2. Change Detection (Name OR GT)
    const nameChanged = oldShip.shipName !== newShip.shipName;
    const gtChanged = oldShip.grossTonnage !== newShip.grossTonnage;
    if (!nameChanged && !gtChanged) {
        console.log(`Ship ${shipId} updated, but Name/GT unchanged. Skipping sync.`);
        return;
    }
    const db = admin.firestore();
    console.log(`Ship ${shipId} changed. Name: ${oldShip.shipName}->${newShip.shipName}, GT: ${oldShip.grossTonnage}->${newShip.grossTonnage}`);
    // 3. Define the update payload
    const visitUpdate = {
        updatedBy: 'System (Ship Update)',
        statusLastUpdated: firestore_2.FieldValue.serverTimestamp()
    };
    const tripUpdate = {
        lastModifiedBy: 'System (Ship Update)',
        lastModifiedAt: firestore_2.FieldValue.serverTimestamp()
    };
    // Only update fields that actually changed
    if (nameChanged) {
        visitUpdate.shipName = newShip.shipName;
        visitUpdate.shipName_lowercase = newShip.shipName_lowercase || newShip.shipName.toLowerCase();
        tripUpdate.shipName = newShip.shipName;
    }
    if (gtChanged) {
        visitUpdate.grossTonnage = newShip.grossTonnage;
        tripUpdate.gt = newShip.grossTonnage;
    }
    // 4. Calculate Lookback Date (60 days ago)
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
    // ==========================================================================================
    // PHASE 1: SYNC VISITS
    // Target: Active Visits (ANY date) OR Recent Visits (> 60 days)
    // ==========================================================================================
    // Query 1: All Active Visits (regardless of date)
    const activeVisitsQuery = db.collection('visits_new')
        .where('shipId', '==', shipId)
        .where('currentStatus', 'in', ['Due', 'Awaiting Berth', 'Alongside']);
    // Query 2: Recent History (Sailed/Cancelled within 60 days)
    const recentVisitsQuery = db.collection('visits_new')
        .where('shipId', '==', shipId)
        .where('initialEta', '>=', sixtyDaysAgo);
    const [activeVisitsSnap, recentVisitsSnap] = await Promise.all([
        activeVisitsQuery.get(),
        recentVisitsQuery.get()
    ]);
    // Merge results (prevent duplicates if a visit matches both queries)
    const uniqueVisitIds = new Set();
    const visitsToUpdate = [];
    [...activeVisitsSnap.docs, ...recentVisitsSnap.docs].forEach(doc => {
        if (!uniqueVisitIds.has(doc.id)) {
            uniqueVisitIds.add(doc.id);
            visitsToUpdate.push(doc.ref);
        }
    });
    // Batch Update Visits
    if (visitsToUpdate.length > 0) {
        const batches = [];
        let currentBatch = db.batch();
        let count = 0;
        for (const ref of visitsToUpdate) {
            currentBatch.update(ref, visitUpdate);
            count++;
            if (count === 499) { // Firestore batch limit is 500
                batches.push(currentBatch.commit());
                currentBatch = db.batch();
                count = 0;
            }
        }
        if (count > 0)
            batches.push(currentBatch.commit());
        await Promise.all(batches);
        console.log(`Synced ${uniqueVisitIds.size} visits for ship ${newShip.shipName}`);
    }
    // ==========================================================================================
    // PHASE 2: SYNC TRIPS (Billing)
    // Target: Recent Trips (> 60 days)
    // ==========================================================================================
    // Note: We use 'boarding' date as the proxy for trip time. 
    // If boarding is null (rare for confirmed trips), we skip it as it's likely pre-billing.
    const tripsQuery = db.collection('trips')
        .where('shipId', '==', shipId)
        .where('boarding', '>=', sixtyDaysAgo);
    const tripsSnap = await tripsQuery.get();
    if (!tripsSnap.empty) {
        const batches = [];
        let currentBatch = db.batch();
        let count = 0;
        for (const doc of tripsSnap.docs) {
            currentBatch.update(doc.ref, tripUpdate);
            count++;
            if (count === 499) {
                batches.push(currentBatch.commit());
                currentBatch = db.batch();
                count = 0;
            }
        }
        if (count > 0)
            batches.push(currentBatch.commit());
        await Promise.all(batches);
        console.log(`Synced ${tripsSnap.size} trips for ship ${newShip.shipName}`);
    }
});
//# sourceMappingURL=syncShipDetails.js.map