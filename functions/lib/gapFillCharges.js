"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.gapFillCharges = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const firestore_1 = require("firebase-admin/firestore");
/**
 * One-off function to "catch up" missed charges during the dual-run gap.
 * Queries charges from recent days and syncs them to trips.
 */
exports.gapFillCharges = (0, https_1.onCall)({ cors: true, region: "europe-west1" }, async (request) => {
    const db = admin.firestore();
    // TARGET DATE: Feb 2nd 2026 (Migration start approx)
    const cutOffDate = new Date("2026-02-02T00:00:00Z");
    console.log(`Starting Gap Fill for Charges since ${cutOffDate.toISOString()}...`);
    // Query Charges based on 'updateTime' (Last Modified) to catch ANY recent activity
    // regardless of when the trip actually happened.
    const chargesSnapshot = await db.collection('charges')
        .where('updateTime', '>=', cutOffDate)
        .get();
    console.log(`Found ${chargesSnapshot.size} charges to process.`);
    let updatedCount = 0;
    let createdCount = 0;
    for (const doc of chargesSnapshot.docs) {
        const charge = doc.data();
        // const chargeId = doc.id; // Unused
        // --- BRIDGE LOGIC START ---
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
        let matchingTripId = null;
        // A: Match by Visit ID
        if (visitId) {
            const tripQuery = await db.collection('trips').where('visitId', '==', visitId).get();
            const targetType = mapChargeTypeToTripType(chargeType);
            const potentialMatch = tripQuery.docs.find(tDoc => tDoc.data().typeTrip === targetType);
            if (potentialMatch)
                matchingTripId = potentialMatch.id;
        }
        // B: Match by Heuristic
        if (!matchingTripId && shipName && chargeDate) {
            const start = new Date(chargeDate);
            start.setHours(start.getHours() - 24);
            const end = new Date(chargeDate);
            end.setHours(end.getHours() + 24);
            const tripQuery = await db.collection('trips')
                .where('boarding', '>=', start)
                .where('boarding', '<=', end)
                .get();
            const normalizedChargeShip = shipName.trim().toLowerCase();
            const potentialMatch = tripQuery.docs.find(tDoc => {
                const t = tDoc.data();
                const tShip = (t.shipName || t.ship || '').toLowerCase();
                return tShip.includes(normalizedChargeShip) || normalizedChargeShip.includes(tShip);
            });
            if (potentialMatch)
                matchingTripId = potentialMatch.id;
        }
        // UPDATE or CREATE
        if (matchingTripId) {
            const updatePayload = {
                isConfirmed: true,
                confirmedAt: charge.created_at || charge.date || firestore_1.FieldValue.serverTimestamp(),
                confirmedBy: charge.user_name || charge.createdBy || 'Legacy System (GapFill)',
                shipName: shipName,
                gt: charge.gt || 0,
                lastModifiedAt: firestore_1.FieldValue.serverTimestamp(),
                lastModifiedBy: 'GapFill'
            };
            await db.collection('trips').doc(matchingTripId).update(updatePayload);
            updatedCount++;
        }
        else {
            // Create Standalone
            const newTrip = {
                typeTrip: mapChargeTypeToTripType(chargeType),
                shipName: shipName,
                gt: charge.gt || 0,
                boarding: chargeDate ? firestore_1.Timestamp.fromDate(chargeDate) : firestore_1.Timestamp.now(),
                isConfirmed: true,
                confirmedAt: charge.created_at || charge.date || firestore_1.Timestamp.now(),
                confirmedBy: charge.user_name || charge.createdBy || 'Legacy System (GapFill)',
                visitId: visitId || null,
                source: 'GapFill',
                recordStatus: 'active',
                recordedAt: firestore_1.Timestamp.now()
            };
            await db.collection('trips').add(newTrip);
            createdCount++;
        }
        // --- BRIDGE LOGIC END ---
    }
    return {
        message: "Gap Fill Complete",
        processed: chargesSnapshot.size,
        tripsUpdated: updatedCount,
        tripsCreated: createdCount
    };
});
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
//# sourceMappingURL=gapFillCharges.js.map