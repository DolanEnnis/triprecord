"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bridgeChargesToTrips = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");
const firestore_2 = require("firebase-admin/firestore");
// Initialize admin if not already initialized (index.ts does it too, but safe to check)
if (admin.apps.length === 0) {
    admin.initializeApp();
}
/**
 * Bridge function to sync data from /charges to /trips in REAL-TIME.
 *
 * WHY: The user is running "Dual Systems" (Old & New).
 * - Old System writes to /charges.
 * - New System reads from /trips.
 * - We need /charges to instantly reflect in /trips so the New System has live data.
 */
exports.bridgeChargesToTrips = (0, firestore_1.onDocumentWritten)("charges/{chargeId}", async (event) => {
    var _a;
    const chargeId = event.params.chargeId;
    const db = admin.firestore();
    // 1. Handle Deletion (Optional - usually we don't delete trips if charge is deleted, just unconfirm?)
    // For now, we'll log it and ignore deletions to be safe.
    if (!((_a = event.data) === null || _a === void 0 ? void 0 : _a.after.exists)) {
        console.log(`Charge ${chargeId} was deleted. No action taken on Trips to prevent data loss.`);
        return;
    }
    const charge = event.data.after.data();
    if (!charge)
        return;
    console.log(`Processing bridge for Charge ${chargeId}:`, charge);
    // 2. Extract Key Fields
    // Schema mapping based on User Screenshot (Feb 2026)
    const visitId = charge.visitid || charge.visitId;
    const shipName = charge.ship || charge.vessel;
    const chargeType = charge.typeTrip || charge.type || charge.category || 'Unknown';
    // Extract Date: Prefer 'boarding', fall back to 'date'
    let chargeDate = null;
    if (charge.boarding && charge.boarding.toDate) {
        chargeDate = charge.boarding.toDate();
    }
    else if (charge.boarding) {
        chargeDate = new Date(charge.boarding);
    }
    else if (charge.date && charge.date.toDate) {
        chargeDate = charge.date.toDate();
    }
    else if (charge.date) {
        chargeDate = new Date(charge.date);
    }
    // 3. Find Matching Trip
    let matchingTripId = null;
    // matchingTripData removed (unused)
    // STRATEGY A: Match by Visit ID (Strongest Match)
    if (visitId) {
        console.log(`Searching for trip with visitId: ${visitId}`);
        const tripQuery = await db.collection('trips')
            .where('visitId', '==', visitId)
            .get();
        // Filter by type if possible
        // Charge Types: 'Inward', 'Outward', 'Shift', 'Anchorage'
        // Trip Types: 'In', 'Out', 'Shift', 'Anchorage'
        const targetType = mapChargeTypeToTripType(chargeType);
        const potentialMatch = tripQuery.docs.find(doc => {
            const t = doc.data();
            return t.typeTrip === targetType;
        });
        if (potentialMatch) {
            matchingTripId = potentialMatch.id;
            // matchingTripData = potentialMatch.data();
            console.log(`Found matching trip by VisitID: ${matchingTripId}`);
        }
        else {
            // Fallback: If no generic type match, maybe just take the first one? 
            // Or if it's a standalone charge?
            console.log(`No trip found for visitId ${visitId} with type ${targetType}`);
        }
    }
    // STRATEGY B: Match by Ship Name + Date (Heuristic)
    if (!matchingTripId && shipName && chargeDate) {
        console.log(`Searching for trip by Ship: ${shipName} around ${chargeDate.toISOString()}`);
        // Date range Query (±24 hours)
        const start = new Date(chargeDate);
        start.setHours(start.getHours() - 24);
        const end = new Date(chargeDate);
        end.setHours(end.getHours() + 24);
        const tripQuery = await db.collection('trips')
            .where('boarding', '>=', start)
            .where('boarding', '<=', end)
            .get();
        // Filter by ship name (normalized)
        const normalizedChargeShip = shipName.trim().toLowerCase();
        const potentialMatch = tripQuery.docs.find(doc => {
            const t = doc.data();
            // Check ship name (heuristic)
            // tripShip removed (unused)
            // Actually /trips usually have trip.shipName populated by now? Or trip.ship (string)?
            // In the new model, we added shipName. Before that, it might just be 'ship' field?
            // Let's check both.
            const tShip = (t.shipName || t.ship || '').toLowerCase();
            return tShip.includes(normalizedChargeShip) || normalizedChargeShip.includes(tShip);
        });
        if (potentialMatch) {
            matchingTripId = potentialMatch.id;
            // matchingTripData = potentialMatch.data();
            console.log(`Found matching trip by Heuristic: ${matchingTripId}`);
        }
    }
    // 4. Update or Create
    if (matchingTripId) {
        // UPDATE EXISTING TRIP
        console.log(`Updating Trip ${matchingTripId} with billing data...`);
        const updatePayload = {
            isConfirmed: true,
            confirmedAt: charge.created_at || charge.date || firestore_2.FieldValue.serverTimestamp(), // Use charge creation time
            confirmedBy: charge.user_name || charge.createdBy || 'Legacy System',
            confirmedById: charge.user_id || charge.createdById || null,
            // Copy Billing Fields
            shipName: shipName,
            gt: charge.gt || 0,
            // Preserve original structure
            lastModifiedAt: firestore_2.FieldValue.serverTimestamp(),
            lastModifiedBy: 'Bridge System'
        };
        // Only update if changed? Firestore handles idempotency well.
        await db.collection('trips').doc(matchingTripId).update(updatePayload);
        console.log(`Trip ${matchingTripId} updated successfully.`);
    }
    else {
        // CREATE NEW TRIP (Orphan Charge)
        // If we can't find a trip, we must create one to ensure billing data isn't lost.
        console.log(`No matching trip found. Creating new STANDALONE CONFIRMED TRIP.`);
        const newTrip = {
            // Basic Info
            typeTrip: mapChargeTypeToTripType(chargeType),
            shipName: shipName,
            gt: charge.gt || 0,
            // Best guess date
            boarding: chargeDate ? firestore_2.Timestamp.fromDate(chargeDate) : firestore_2.Timestamp.now(),
            // Confirmation Info
            isConfirmed: true,
            confirmedAt: charge.created_at || charge.date || firestore_2.Timestamp.now(),
            confirmedBy: charge.user_name || charge.createdBy || 'Legacy System',
            confirmedById: charge.user_id || charge.createdById || null,
            // Linkage
            visitId: visitId || null,
            source: 'Legacy Bridge',
            // Metadata
            recordStatus: 'active',
            recordedAt: firestore_2.Timestamp.now(),
            recordedBy: 'Bridge System'
        };
        const ref = await db.collection('trips').add(newTrip);
        console.log(`Created new Trip ${ref.id} for Charge ${chargeId}`);
    }
});
// Helper to map types
function mapChargeTypeToTripType(chargeType) {
    const norm = chargeType.toLowerCase();
    if (norm.includes('in'))
        return 'In';
    if (norm.includes('out'))
        return 'Out';
    if (norm.includes('shift'))
        return 'Shift';
    if (norm.includes('anchor'))
        return 'Anchorage';
    return 'Other';
}
//# sourceMappingURL=bridgeChargesToTrips.js.map