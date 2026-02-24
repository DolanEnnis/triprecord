"use strict";
/**
 * ============================================================
 * AUDIT ENGINE — Cloud Functions (Delta/Diff Edition)
 * ============================================================
 *
 * LEARNING: WHY DELTA LOGGING INSTEAD OF FULL-STATE SNAPSHOTS?
 * --------------------------------------------------------------------------
 * Full-state logging stores a complete copy of the document before AND after
 * every write. That gets expensive fast — a trip document with 30 fields means
 * 60 field-writes per audit entry, even if only one field changed.
 *
 * Delta logging stores ONLY what changed:
 *   { pilot: { old: 'John', new: 'Mary' } }
 *
 * Benefits:
 *   1. 90%+ smaller Firestore writes → lower costs
 *   2. Instant readability — you see exactly what changed at a glance
 *   3. No need to diff client-side in the UI — the data is pre-diffed
 *   4. "Ghost save" detection — if nothing actually changed, we abort
 *      entirely and pay zero Firestore write costs
 *
 * HOW STAMPS STILL WORK:
 * --------------------------------------------------------------------------
 * The Angular app still attaches `_modifiedBy` and `_modifiedFrom` to every
 * payload. The calculateDiff() function explicitly skips those two keys so
 * they never appear as "changed fields" in the diff output.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.onShipWritten = exports.onVisitWritten = exports.onTripWritten = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");
const firestore_2 = require("firebase-admin/firestore");
// ----------------------------------------------------------------
// STEP 1: Delta Diff Calculator
// ----------------------------------------------------------------
/**
 * Compares two Firestore document snapshots and returns ONLY the fields
 * that actually changed, along with their old and new values.
 *
 * LEARNING: WHY JSON.stringify FOR COMPARISON?
 * Firestore documents can contain nested objects (like Timestamps, maps, arrays).
 * A shallow `===` check fails on objects because two separate object references
 * are never equal even if they contain the same data.
 * JSON.stringify converts both values to a canonical string, making deep comparison
 * safe and simple for the kinds of data Firestore payloads contain.
 *
 * @param before The document data before the write (from event.data.before)
 * @param after  The document data after the write (from event.data.after)
 * @returns A map of changed fields: { fieldName: { old: any, new: any } }
 */
function calculateDiff(before, after) {
    const changes = {};
    // Collect all unique keys from both snapshots
    const allKeys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
    allKeys.forEach(key => {
        // Skip the internal audit hint fields — they're plumbing, not data.
        // Including them would create noise like: { _modifiedBy: { old: 'uid1', new: 'uid1' } }
        if (key === '_modifiedBy' || key === '_modifiedFrom')
            return;
        const beforeVal = before === null || before === void 0 ? void 0 : before[key];
        const afterVal = after === null || after === void 0 ? void 0 : after[key];
        // JSON.stringify gives us a safe deep comparison for nested Firestore payloads
        if (JSON.stringify(beforeVal) !== JSON.stringify(afterVal)) {
            changes[key] = {
                old: beforeVal !== null && beforeVal !== void 0 ? beforeVal : null,
                new: afterVal !== null && afterVal !== void 0 ? afterVal : null,
            };
        }
    });
    return changes;
}
function resolveAction(before, after) {
    if (!before)
        return 'CREATE';
    if (!after)
        return 'DELETE';
    return 'UPDATE';
}
// ----------------------------------------------------------------
// STEP 3: Build the audit log entry (delta version)
// ----------------------------------------------------------------
/**
 * Builds an audit record and writes it to the subcollection.
 *
 * For UPDATE events: stores the `changes` diff map only.
 * For CREATE/DELETE events: stores the action with user context.
 * If UPDATE has zero changes (ghost save): returns null to abort.
 *
 * LEARNING: WHY ABORT ON ZERO CHANGES?
 * Sometimes Firestore writes are triggered by code that re-saves a document
 * without changing any data (e.g., from a data repair function). There's no
 * value in creating an audit entry that says "nothing happened", and doing
 * nothing saves a Firestore write operation.
 *
 * @param parentPath The collection path for the subcollection (e.g. 'trips/abc123')
 * @param before     Document data before the write
 * @param after      Document data after the write
 * @param expiresAt  Optional TTL date. When provided, the audit log document will
 *                   be automatically deleted by Firestore after this date
 *                   (requires the TTL policy to be enabled on `expiresAt` in the console).
 */
async function processAuditEvent(parentPath, before, after, expiresAt) {
    var _a, _b, _c;
    const action = resolveAction(before, after);
    // Extract the hint fields — present in the 'after' state for CREATE/UPDATE,
    // or the 'before' state for DELETE (after is undefined on delete)
    const hintSource = (_a = after !== null && after !== void 0 ? after : before) !== null && _a !== void 0 ? _a : {};
    const modifiedBy = String((_b = hintSource['_modifiedBy']) !== null && _b !== void 0 ? _b : 'system');
    const modifiedFrom = String((_c = hintSource['_modifiedFrom']) !== null && _c !== void 0 ? _c : 'system');
    // LEARNING: HOW FIRESTORE TTL WORKS
    // TTL is NOT a countdown timer set on the document — Firestore doesn't work that way.
    // Instead:
    //  1. You store a future Timestamp in the document (expiresAt).
    //  2. You configure a TTL policy in the Firestore console that says
    //     "delete documents in this collection group when expiresAt < now".
    //  3. Firestore's background daemon sweeps and deletes expired documents
    //     automatically, usually within 24–72 hours after expiry.
    //  4. Deletion is FREE — it does NOT count as a Firestore delete operation.
    //
    // We only set this on trip audit logs (not ships/visits) as requested.
    // The TTL policy must be enabled ONCE in the Firestore console on the
    // `audit_logs` collection group, field path `expiresAt`.
    const ttlField = expiresAt
        ? { expiresAt: admin.firestore.Timestamp.fromDate(expiresAt) }
        : {};
    let auditRecord;
    if (action === 'UPDATE') {
        // DELTA LOGGING: only store what changed
        const changes = calculateDiff(before, after);
        // GHOST SAVE DETECTION: if nothing changed, abort — zero Firestore cost
        if (Object.keys(changes).length === 0) {
            console.log(`[AuditEngine] Ghost save detected on ${parentPath} — no changes, skipping log.`);
            return;
        }
        auditRecord = Object.assign({ timestamp: firestore_2.FieldValue.serverTimestamp(), action: 'UPDATE', modifiedBy,
            modifiedFrom,
            changes }, ttlField);
    }
    else {
        // CREATE or DELETE — no meaningful diff to show.
        auditRecord = Object.assign({ timestamp: firestore_2.FieldValue.serverTimestamp(), action,
            modifiedBy,
            modifiedFrom }, ttlField);
    }
    const logPath = `${parentPath}/audit_logs`;
    await admin.firestore().collection(logPath).add(auditRecord);
}
// ================================================================
// EXPORTED TRIGGERS
// ================================================================
// Each trigger uses onDocumentWritten (v2) which covers create + update + delete.
// The delta diff is only calculated for UPDATE events — create/delete just
// record the actor. See processAuditEvent() above for the branching logic.
// ================================================================
/**
 * Logs every write to the `trips` collection.
 * Audit logs expire after 1 year via Firestore TTL on the `expiresAt` field.
 * UPDATE log path: `trips/{tripId}/audit_logs/{autoId}`
 */
exports.onTripWritten = (0, firestore_1.onDocumentWritten)({ document: 'trips/{tripId}', region: 'europe-west1' }, async (event) => {
    var _a, _b, _c, _d;
    const before = (_b = (_a = event.data) === null || _a === void 0 ? void 0 : _a.before) === null || _b === void 0 ? void 0 : _b.data();
    const after = (_d = (_c = event.data) === null || _c === void 0 ? void 0 : _c.after) === null || _d === void 0 ? void 0 : _d.data();
    // Compute a date exactly 1 year from now for the TTL field.
    // Firestore's TTL daemon will delete this audit log document automatically
    // once this date passes (requires TTL policy enabled in Firestore console).
    const oneYearFromNow = new Date();
    oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);
    await processAuditEvent(`trips/${event.params['tripId']}`, before, after, oneYearFromNow);
});
/**
 * Logs every write to the `visits_new` collection.
 * UPDATE log path: `visits_new/{visitId}/audit_logs/{autoId}`
 */
exports.onVisitWritten = (0, firestore_1.onDocumentWritten)({ document: 'visits_new/{visitId}', region: 'europe-west1' }, async (event) => {
    var _a, _b, _c, _d;
    const before = (_b = (_a = event.data) === null || _a === void 0 ? void 0 : _a.before) === null || _b === void 0 ? void 0 : _b.data();
    const after = (_d = (_c = event.data) === null || _c === void 0 ? void 0 : _c.after) === null || _d === void 0 ? void 0 : _d.data();
    await processAuditEvent(`visits_new/${event.params['visitId']}`, before, after);
});
/**
 * Logs every write to the `ships` collection.
 * UPDATE log path: `ships/{shipId}/audit_logs/{autoId}`
 */
exports.onShipWritten = (0, firestore_1.onDocumentWritten)({ document: 'ships/{shipId}', region: 'europe-west1' }, async (event) => {
    var _a, _b, _c, _d;
    const before = (_b = (_a = event.data) === null || _a === void 0 ? void 0 : _a.before) === null || _b === void 0 ? void 0 : _b.data();
    const after = (_d = (_c = event.data) === null || _c === void 0 ? void 0 : _c.after) === null || _d === void 0 ? void 0 : _d.data();
    await processAuditEvent(`ships/${event.params['shipId']}`, before, after);
});
//# sourceMappingURL=auditEngine.js.map