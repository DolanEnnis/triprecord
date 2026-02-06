"use strict";
/**
 * OPTIMIZED Sync Cloud Function: Copies billing data from /charges to /trips
 *
 * OPTIMIZATION: Loads ALL trips upfront into memory, then matches in-memory.
 * This reduces ~9000 individual queries to just 2 queries (charges + trips).
 *
 * Safe to run multiple times - idempotent operation.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeOrphanCharges = exports.syncChargesToTrips = void 0;
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
/**
 * Safely converts any date format to a JavaScript Date object.
 * Handles Firestore Timestamp, Date objects, and ISO strings.
 */
function safeToDate(value) {
    if (!value)
        return null;
    // Firestore Timestamp
    if (typeof value.toDate === 'function') {
        return value.toDate();
    }
    // Already a Date
    if (value instanceof Date) {
        return value;
    }
    // ISO string or other string format
    if (typeof value === 'string') {
        const parsed = new Date(value);
        return isNaN(parsed.getTime()) ? null : parsed;
    }
    // Number (epoch ms)
    if (typeof value === 'number') {
        return new Date(value);
    }
    return null;
}
/**
 * Main sync function - OPTIMIZED VERSION
 * Loads all data upfront for in-memory matching
 */
exports.syncChargesToTrips = (0, https_1.onCall)({
    cors: true,
    region: "europe-west1",
    timeoutSeconds: 540, // 9 minutes max
    memory: "1GiB" // Increased memory for large dataset
}, async (request) => {
    const db = admin.firestore();
    const result = {
        totalCharges: 0,
        tripsUpdated: 0,
        orphans: [],
        errors: [],
        alreadySynced: 0,
        matchBreakdown: {
            byVisitId: 0,
            byShipAndBoarding: 0
        }
    };
    try {
        console.log("OPTIMIZED SYNC: Loading all data upfront...");
        // ========================================
        // STEP 1: Load ALL charges (one query)
        // ========================================
        console.log("Loading charges...");
        const chargesSnapshot = await db.collection("charges").get();
        result.totalCharges = chargesSnapshot.size;
        console.log(`Loaded ${result.totalCharges} charges`);
        // ========================================
        // STEP 2: Load ALL trips (one query)
        // ========================================
        console.log("Loading trips...");
        const tripsSnapshot = await db.collection("trips").get();
        console.log(`Loaded ${tripsSnapshot.size} trips`);
        // ========================================
        // STEP 3: Build indexes for fast matching
        // ========================================
        console.log("Building indexes...");
        // Index 1: Trips by visitId + typeTrip (for Tier 1 matching)
        // Key format: "visitId|typeTrip"
        const tripsByVisitAndType = new Map();
        // Index 2: Trips by ship name (lowercase) + typeTrip + approximate boarding (for Tier 2)
        // Key format: "shipname|typeTrip|YYYY-MM-DD"
        const tripsByShipTypeDate = new Map();
        for (const doc of tripsSnapshot.docs) {
            const trip = Object.assign({ id: doc.id }, doc.data());
            // Index by visitId + typeTrip
            if (trip.visitId) {
                const key1 = `${trip.visitId}|${trip.typeTrip}`;
                if (!tripsByVisitAndType.has(key1)) {
                    tripsByVisitAndType.set(key1, []);
                }
                tripsByVisitAndType.get(key1).push(trip);
            }
            // Index by shipName + typeTrip + date (if we have boarding)
            if (trip.shipName && trip.boarding) {
                const boardingDate = safeToDate(trip.boarding);
                if (boardingDate) {
                    const dateKey = boardingDate.toISOString().split('T')[0];
                    const key2 = `${trip.shipName.toLowerCase().trim()}|${trip.typeTrip}|${dateKey}`;
                    if (!tripsByShipTypeDate.has(key2)) {
                        tripsByShipTypeDate.set(key2, []);
                    }
                    tripsByShipTypeDate.get(key2).push(trip);
                }
            }
        }
        console.log(`Built index 1 (visitId+type): ${tripsByVisitAndType.size} entries`);
        console.log(`Built index 2 (ship+type+date): ${tripsByShipTypeDate.size} entries`);
        // ========================================
        // STEP 4: Match and prepare updates
        // ========================================
        console.log("Matching charges to trips...");
        const updates = [];
        for (const chargeDoc of chargesSnapshot.docs) {
            const charge = Object.assign({ id: chargeDoc.id }, chargeDoc.data());
            // Skip if charge has no boarding time (can't match without it)
            const chargeBoarding = safeToDate(charge.boarding);
            if (!chargeBoarding) {
                result.orphans.push({
                    chargeId: charge.id,
                    ship: charge.ship,
                    typeTrip: charge.typeTrip,
                    boarding: "null",
                    reason: "No boarding time"
                });
                continue;
            }
            // Try to find matching trip
            let matchedTrip = null;
            let matchTier = 0;
            // TIER 1: Match by visitId + typeTrip
            if (charge.visitid) {
                const key1 = `${charge.visitid}|${charge.typeTrip}`;
                const candidates = tripsByVisitAndType.get(key1);
                if (candidates && candidates.length > 0) {
                    // If multiple matches, prefer unconfirmed or closest boarding time
                    matchedTrip = findBestMatch(candidates, chargeBoarding);
                    if (matchedTrip)
                        matchTier = 1;
                }
            }
            // TIER 2: Match by ship + typeTrip + date (if Tier 1 failed)
            if (!matchedTrip) {
                const chargeDate = chargeBoarding.toISOString().split('T')[0];
                const key2 = `${charge.ship.toLowerCase().trim()}|${charge.typeTrip}|${chargeDate}`;
                const candidates = tripsByShipTypeDate.get(key2);
                if (candidates && candidates.length > 0) {
                    matchedTrip = findBestMatch(candidates, chargeBoarding);
                    if (matchedTrip)
                        matchTier = 2;
                }
                // Also try day before and day after
                if (!matchedTrip) {
                    const dayBefore = new Date(chargeBoarding.getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                    const dayAfter = new Date(chargeBoarding.getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                    for (const dateKey of [dayBefore, dayAfter]) {
                        const altKey = `${charge.ship.toLowerCase().trim()}|${charge.typeTrip}|${dateKey}`;
                        const altCandidates = tripsByShipTypeDate.get(altKey);
                        if (altCandidates && altCandidates.length > 0) {
                            matchedTrip = findBestMatch(altCandidates, chargeBoarding);
                            if (matchedTrip) {
                                matchTier = 2;
                                break;
                            }
                        }
                    }
                }
            }
            // Record result
            if (matchedTrip) {
                // Check if already synced (has shipName set)
                if (matchedTrip.shipName && matchedTrip.isConfirmed) {
                    result.alreadySynced++;
                }
                else {
                    updates.push({
                        type: 'update',
                        tripId: matchedTrip.id,
                        data: {
                            shipName: charge.ship,
                            gt: charge.gt,
                            confirmedBy: charge.createdBy || null,
                            confirmedById: charge.createdById || null,
                            confirmedAt: charge.updateTime || admin.firestore.FieldValue.serverTimestamp(),
                            isConfirmed: true
                        }
                    });
                }
                if (matchTier === 1)
                    result.matchBreakdown.byVisitId++;
                if (matchTier === 2)
                    result.matchBreakdown.byShipAndBoarding++;
            }
            else {
                // ORPHAN FOUND - CREATE NEW TRIP (Migration)
                const newTripData = {
                    // Core Trip Fields
                    typeTrip: charge.typeTrip,
                    boarding: charge.boarding, // Keep original timestamp/date
                    port: charge.port || null,
                    pilot: charge.pilot || null,
                    pilotNotes: charge.sailingNote || null,
                    extraChargesNotes: charge.extra || null,
                    // Billing Fields
                    shipName: charge.ship,
                    gt: charge.gt,
                    isConfirmed: true,
                    confirmedBy: charge.createdBy || null,
                    confirmedById: charge.createdById || null,
                    confirmedAt: charge.updateTime || admin.firestore.FieldValue.serverTimestamp(),
                    // Metadata
                    source: 'migration', // Track that this came from charge migration
                    migratedFromChargeId: charge.id,
                    // Standard Fields
                    visitId: null, // Standalone trip
                    shipId: 'legacy_migration', // Placeholder
                    recordedAt: charge.boarding || admin.firestore.FieldValue.serverTimestamp(),
                    recordedBy: 'system_migration'
                };
                updates.push({
                    type: 'create',
                    tripId: null, // Auto-generate
                    data: newTripData
                });
            }
        }
        console.log(`Matching complete: ${updates.length} to update, ${result.alreadySynced} already synced, ${result.orphans.length} orphans`);
        // ========================================
        // STEP 5: Batch write updates (Create + Update)
        // ========================================
        console.log("Writing changes...");
        const BATCH_SIZE = 500;
        let batchCount = 0;
        let creates = 0;
        for (let i = 0; i < updates.length; i += BATCH_SIZE) {
            const batch = db.batch();
            const chunk = updates.slice(i, i + BATCH_SIZE);
            for (const op of chunk) {
                if (op.type === 'create') {
                    const newDocRef = db.collection("trips").doc();
                    batch.set(newDocRef, op.data);
                    creates++;
                }
                else if (op.tripId) {
                    const tripRef = db.collection("trips").doc(op.tripId);
                    batch.update(tripRef, op.data);
                }
            }
            await batch.commit();
            batchCount++;
            console.log(`Committed batch ${batchCount} (${chunk.length} ops)`);
        }
        result.tripsUpdated = updates.filter(u => u.type === 'update').length;
        const tripsCreated = updates.filter(u => u.type === 'create').length;
        console.log("SYNC COMPLETE!", JSON.stringify({
            totalCharges: result.totalCharges,
            updated: result.tripsUpdated,
            created: tripsCreated,
            alreadySynced: result.alreadySynced
        }));
        return Object.assign(Object.assign({}, result), { orphans: [], message: `Migration successful. Updated ${result.tripsUpdated}, Created ${tripsCreated} new trips.` });
    }
    catch (error) {
        console.error("Sync failed:", error);
        throw new https_1.HttpsError("internal", `Sync failed: ${error.message}`);
    }
});
/**
 * Find the best matching trip from candidates
 * Prefers: unconfirmed > closest boarding time
 */
function findBestMatch(candidates, chargeBoarding) {
    if (candidates.length === 0)
        return null;
    if (candidates.length === 1)
        return candidates[0];
    // Prefer unconfirmed trips
    const unconfirmed = candidates.filter(t => !t.isConfirmed);
    if (unconfirmed.length === 1)
        return unconfirmed[0];
    // If multiple unconfirmed or all confirmed, find closest boarding time
    const chargeTime = chargeBoarding.getTime();
    const pool = unconfirmed.length > 0 ? unconfirmed : candidates;
    let bestMatch = pool[0];
    let bestDiff = Infinity;
    for (const trip of pool) {
        if (trip.boarding) {
            const tripDate = safeToDate(trip.boarding);
            if (tripDate) {
                const diff = Math.abs(tripDate.getTime() - chargeTime);
                if (diff < bestDiff) {
                    bestDiff = diff;
                    bestMatch = trip;
                }
            }
        }
    }
    return bestMatch;
}
/**
 * Analyze orphan charges to understand their date distribution.
 * Returns breakdown by year-month and other insights.
 */
exports.analyzeOrphanCharges = (0, https_1.onCall)({
    cors: true,
    region: "europe-west1",
    timeoutSeconds: 300,
    memory: "1GiB"
}, async (request) => {
    var _a, _b;
    const db = admin.firestore();
    console.log("Analyzing orphan charges...");
    // Load all charges
    const chargesSnapshot = await db.collection("charges").get();
    console.log(`Loaded ${chargesSnapshot.size} charges`);
    // Load all trips
    const tripsSnapshot = await db.collection("trips").get();
    console.log(`Loaded ${tripsSnapshot.size} trips`);
    // Build trip indexes (same as sync function)
    const tripsByVisitAndType = new Map();
    const tripsByShipTypeDate = new Map();
    for (const doc of tripsSnapshot.docs) {
        const trip = Object.assign({ id: doc.id }, doc.data());
        if (trip.visitId) {
            const key1 = `${trip.visitId}|${trip.typeTrip}`;
            if (!tripsByVisitAndType.has(key1))
                tripsByVisitAndType.set(key1, []);
            tripsByVisitAndType.get(key1).push(trip);
        }
        if (trip.shipName && trip.boarding) {
            const boardingDate = safeToDate(trip.boarding);
            if (boardingDate) {
                const dateKey = boardingDate.toISOString().split('T')[0];
                const key2 = `${trip.shipName.toLowerCase().trim()}|${trip.typeTrip}|${dateKey}`;
                if (!tripsByShipTypeDate.has(key2))
                    tripsByShipTypeDate.set(key2, []);
                tripsByShipTypeDate.get(key2).push(trip);
            }
        }
    }
    // Analyze orphans
    const orphansByMonth = new Map();
    const orphansByYear = new Map();
    const orphansByReason = new Map();
    const sampleOrphans = [];
    let totalOrphans = 0;
    let oldestOrphan = null;
    let newestOrphan = null;
    for (const chargeDoc of chargesSnapshot.docs) {
        const charge = Object.assign({ id: chargeDoc.id }, chargeDoc.data());
        const chargeBoarding = safeToDate(charge.boarding);
        if (!chargeBoarding) {
            totalOrphans++;
            const reason = "No boarding date";
            orphansByReason.set(reason, (orphansByReason.get(reason) || 0) + 1);
            continue;
        }
        // Check if it matches a trip
        let matched = false;
        let reason = "";
        // Tier 1: visitId
        if (charge.visitid) {
            const key1 = `${charge.visitid}|${charge.typeTrip}`;
            if (tripsByVisitAndType.has(key1)) {
                matched = true;
            }
            else {
                reason = "visitId not found in trips";
            }
        }
        else {
            reason = "No visitId";
        }
        // Tier 2: ship + type + date
        if (!matched) {
            const chargeDate = chargeBoarding.toISOString().split('T')[0];
            const key2 = `${(_a = charge.ship) === null || _a === void 0 ? void 0 : _a.toLowerCase().trim()}|${charge.typeTrip}|${chargeDate}`;
            if (tripsByShipTypeDate.has(key2)) {
                matched = true;
            }
            else {
                // Try day before/after
                const dayBefore = new Date(chargeBoarding.getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                const dayAfter = new Date(chargeBoarding.getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                for (const dk of [dayBefore, dayAfter]) {
                    const altKey = `${(_b = charge.ship) === null || _b === void 0 ? void 0 : _b.toLowerCase().trim()}|${charge.typeTrip}|${dk}`;
                    if (tripsByShipTypeDate.has(altKey)) {
                        matched = true;
                        break;
                    }
                }
                if (!matched && reason === "") {
                    reason = "Ship/type/date not found";
                }
            }
        }
        if (!matched) {
            totalOrphans++;
            // Track by year-month
            const yearMonth = chargeBoarding.toISOString().slice(0, 7); // YYYY-MM
            const year = chargeBoarding.getFullYear().toString();
            orphansByMonth.set(yearMonth, (orphansByMonth.get(yearMonth) || 0) + 1);
            orphansByYear.set(year, (orphansByYear.get(year) || 0) + 1);
            orphansByReason.set(reason, (orphansByReason.get(reason) || 0) + 1);
            // Track oldest/newest
            if (!oldestOrphan || chargeBoarding < oldestOrphan)
                oldestOrphan = chargeBoarding;
            if (!newestOrphan || chargeBoarding > newestOrphan)
                newestOrphan = chargeBoarding;
            // Sample orphans (first 20)
            if (sampleOrphans.length < 20) {
                sampleOrphans.push({
                    chargeId: charge.id,
                    ship: charge.ship,
                    typeTrip: charge.typeTrip,
                    boarding: chargeBoarding.toISOString(),
                    reason
                });
            }
        }
    }
    // Sort by month for display
    const monthlyBreakdown = Array.from(orphansByMonth.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([month, count]) => ({ month, count }));
    const yearlyBreakdown = Array.from(orphansByYear.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([year, count]) => ({ year, count }));
    const reasonBreakdown = Array.from(orphansByReason.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([reason, count]) => ({ reason, count }));
    const result = {
        totalCharges: chargesSnapshot.size,
        totalTrips: tripsSnapshot.size,
        totalOrphans,
        oldestOrphan: (oldestOrphan === null || oldestOrphan === void 0 ? void 0 : oldestOrphan.toISOString()) || null,
        newestOrphan: (newestOrphan === null || newestOrphan === void 0 ? void 0 : newestOrphan.toISOString()) || null,
        yearlyBreakdown,
        monthlyBreakdown,
        reasonBreakdown,
        sampleOrphans
    };
    console.log("Analysis complete:", JSON.stringify(result, null, 2));
    return result;
});
//# sourceMappingURL=syncChargesToTrips.js.map