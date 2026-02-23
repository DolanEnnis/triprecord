"use strict";
/**
 * ============================================================
 * AUDIT ENGINE — Cloud Functions
 * ============================================================
 *
 * LEARNING: WHY SERVER-SIDE AUDIT LOGS?
 * --------------------------------------------------------------------------
 * If we let the client write audit logs, a malicious (or buggy) client could
 * skip them, falsify them, or delete them. By doing it in Cloud Functions:
 *
 *   1. Every write to `ships`, `visits_new`, `trips` ALWAYS triggers a log.
 *   2. The log is written by the `Admin SDK`, which bypasses all Firestore
 *      security rules — the same rules that say `allow write: if false` on
 *      the `audit_logs` subcollections.
 *   3. The log is therefore IMMUTABLE from the client's perspective.
 *
 * HOW THE STAMP WORKS:
 * --------------------------------------------------------------------------
 * The Angular app attaches two "hint" fields to every payload:
 *   - `_modifiedBy`   → Firebase UID of the saving user
 *   - `_modifiedFrom` → Angular Router URL (e.g. '/edit/abc123')
 *
 * This function reads those hints, strips them from the state snapshots
 * (so the stored "before/after" state is clean), and builds the audit entry.
 *
 * If the hints are missing (e.g. a Cloud Function triggering another write,
 * like the bridgeChargesToTrips function), the log entry defaults to 'system'.
 */
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.onShipWritten = exports.onVisitWritten = exports.onTripWritten = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");
const firestore_2 = require("firebase-admin/firestore");
function resolveAction(before, after) {
    // LEARNING: Before/after existence is the canonical way to detect the operation type.
    // onCreate  → before is undefined
    // onDelete  → after is undefined
    // onUpdate  → both exist
    if (!before)
        return 'CREATE';
    if (!after)
        return 'DELETE';
    return 'UPDATE';
}
// ----------------------------------------------------------------
// STEP 2: Strip metadata hint fields from a state snapshot
// ----------------------------------------------------------------
// We don't want `_modifiedBy` and `_modifiedFrom` appearing inside the
// "previousState" and "newState" snapshots — those are internal plumbing, not data.
function stripAuditHints(data) {
    const { _modifiedBy, _modifiedFrom } = data, cleanData = __rest(data, ["_modifiedBy", "_modifiedFrom"]);
    return cleanData;
}
// ----------------------------------------------------------------
// STEP 3: Build the audit log entry
// ----------------------------------------------------------------
function buildAuditEntry(before, after) {
    var _a, _b, _c;
    const action = resolveAction(before, after);
    // The "source" of metadata hints is the `after` state on create/update,
    // or the `before` state on delete (after doesn't exist on delete).
    const hintSource = (_a = after !== null && after !== void 0 ? after : before) !== null && _a !== void 0 ? _a : {};
    const modifiedBy = (_b = hintSource['_modifiedBy']) !== null && _b !== void 0 ? _b : 'system';
    const modifiedFrom = (_c = hintSource['_modifiedFrom']) !== null && _c !== void 0 ? _c : 'system';
    return {
        // LEARNING: FieldValue.serverTimestamp() is critical here.
        // Client timestamps can be spoofed. Server timestamps are set by Firestore
        // and are always accurate and monotonically ordered — ideal for audit logs.
        timestamp: firestore_2.FieldValue.serverTimestamp(),
        action,
        modifiedBy,
        modifiedFrom,
        // Store clean snapshots — internal hint fields stripped out
        previousState: before ? stripAuditHints(before) : null,
        newState: after ? stripAuditHints(after) : null,
    };
}
// ----------------------------------------------------------------
// STEP 4: Write to the audit_logs subcollection
// ----------------------------------------------------------------
// We use `Date.now()` as the document ID — this gives us:
//  - Chronological ordering by document ID
//  - Guaranteed uniqueness (millisecond precision, functions run in isolation)
//  - No extra `getDocs` call needed to order by ID
async function writeAuditLog(parentPath, auditEntry) {
    const logPath = `${parentPath}/audit_logs/${Date.now()}`;
    await admin.firestore().doc(logPath).set(auditEntry);
}
// ================================================================
// EXPORTED TRIGGERS
// ================================================================
// Each trigger uses `onDocumentWritten` (v2 API) which combines
// onCreate, onUpdate, and onDelete into a single handler.
// This is cleaner than registering three separate functions per collection.
// ================================================================
/**
 * Logs every write to the `trips` collection.
 * Log path: `trips/{tripId}/audit_logs/{timestamp}`
 */
exports.onTripWritten = (0, firestore_1.onDocumentWritten)({
    document: 'trips/{tripId}',
    region: 'europe-west1', // Must match existing functions to avoid cold start latency
}, async (event) => {
    var _a, _b, _c, _d;
    const before = (_b = (_a = event.data) === null || _a === void 0 ? void 0 : _a.before) === null || _b === void 0 ? void 0 : _b.data();
    const after = (_d = (_c = event.data) === null || _c === void 0 ? void 0 : _c.after) === null || _d === void 0 ? void 0 : _d.data();
    const auditEntry = buildAuditEntry(before, after);
    await writeAuditLog(`trips/${event.params['tripId']}`, auditEntry);
});
/**
 * Logs every write to the `visits_new` collection.
 * Log path: `visits_new/{visitId}/audit_logs/{timestamp}`
 */
exports.onVisitWritten = (0, firestore_1.onDocumentWritten)({
    document: 'visits_new/{visitId}',
    region: 'europe-west1',
}, async (event) => {
    var _a, _b, _c, _d;
    const before = (_b = (_a = event.data) === null || _a === void 0 ? void 0 : _a.before) === null || _b === void 0 ? void 0 : _b.data();
    const after = (_d = (_c = event.data) === null || _c === void 0 ? void 0 : _c.after) === null || _d === void 0 ? void 0 : _d.data();
    const auditEntry = buildAuditEntry(before, after);
    await writeAuditLog(`visits_new/${event.params['visitId']}`, auditEntry);
});
/**
 * Logs every write to the `ships` collection.
 * Log path: `ships/{shipId}/audit_logs/{timestamp}`
 */
exports.onShipWritten = (0, firestore_1.onDocumentWritten)({
    document: 'ships/{shipId}',
    region: 'europe-west1',
}, async (event) => {
    var _a, _b, _c, _d;
    const before = (_b = (_a = event.data) === null || _a === void 0 ? void 0 : _a.before) === null || _b === void 0 ? void 0 : _b.data();
    const after = (_d = (_c = event.data) === null || _c === void 0 ? void 0 : _c.after) === null || _d === void 0 ? void 0 : _d.data();
    const auditEntry = buildAuditEntry(before, after);
    await writeAuditLog(`ships/${event.params['shipId']}`, auditEntry);
});
//# sourceMappingURL=auditEngine.js.map