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

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

// ----------------------------------------------------------------
// STEP 1: Determine the action type
// ----------------------------------------------------------------
type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE';

function resolveAction(
  before: admin.firestore.DocumentData | undefined,
  after: admin.firestore.DocumentData | undefined
): AuditAction {
  // LEARNING: Before/after existence is the canonical way to detect the operation type.
  // onCreate  → before is undefined
  // onDelete  → after is undefined
  // onUpdate  → both exist
  if (!before) return 'CREATE';
  if (!after) return 'DELETE';
  return 'UPDATE';
}

// ----------------------------------------------------------------
// STEP 2: Strip metadata hint fields from a state snapshot
// ----------------------------------------------------------------
// We don't want `_modifiedBy` and `_modifiedFrom` appearing inside the
// "previousState" and "newState" snapshots — those are internal plumbing, not data.
function stripAuditHints(
  data: admin.firestore.DocumentData
): admin.firestore.DocumentData {
  const { _modifiedBy, _modifiedFrom, ...cleanData } = data;
  return cleanData;
}

// ----------------------------------------------------------------
// STEP 3: Build the audit log entry
// ----------------------------------------------------------------
function buildAuditEntry(
  before: admin.firestore.DocumentData | undefined,
  after: admin.firestore.DocumentData | undefined
): admin.firestore.DocumentData {
  const action = resolveAction(before, after);

  // The "source" of metadata hints is the `after` state on create/update,
  // or the `before` state on delete (after doesn't exist on delete).
  const hintSource = after ?? before ?? {};
  const modifiedBy: string = hintSource['_modifiedBy'] ?? 'system';
  const modifiedFrom: string = hintSource['_modifiedFrom'] ?? 'system';

  return {
    // LEARNING: FieldValue.serverTimestamp() is critical here.
    // Client timestamps can be spoofed. Server timestamps are set by Firestore
    // and are always accurate and monotonically ordered — ideal for audit logs.
    timestamp: FieldValue.serverTimestamp(),
    action,
    modifiedBy,
    modifiedFrom,

    // Store clean snapshots — internal hint fields stripped out
    previousState: before ? stripAuditHints(before) : null,
    newState:      after  ? stripAuditHints(after)  : null,
  };
}

// ----------------------------------------------------------------
// STEP 4: Write to the audit_logs subcollection
// ----------------------------------------------------------------
// We use `Date.now()` as the document ID — this gives us:
//  - Chronological ordering by document ID
//  - Guaranteed uniqueness (millisecond precision, functions run in isolation)
//  - No extra `getDocs` call needed to order by ID
async function writeAuditLog(
  parentPath: string,
  auditEntry: admin.firestore.DocumentData
): Promise<void> {
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
export const onTripWritten = onDocumentWritten(
  {
    document: 'trips/{tripId}',
    region: 'europe-west1', // Must match existing functions to avoid cold start latency
  },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    const auditEntry = buildAuditEntry(before, after);
    await writeAuditLog(`trips/${event.params['tripId']}`, auditEntry);
  }
);

/**
 * Logs every write to the `visits_new` collection.
 * Log path: `visits_new/{visitId}/audit_logs/{timestamp}`
 */
export const onVisitWritten = onDocumentWritten(
  {
    document: 'visits_new/{visitId}',
    region: 'europe-west1',
  },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    const auditEntry = buildAuditEntry(before, after);
    await writeAuditLog(`visits_new/${event.params['visitId']}`, auditEntry);
  }
);

/**
 * Logs every write to the `ships` collection.
 * Log path: `ships/{shipId}/audit_logs/{timestamp}`
 */
export const onShipWritten = onDocumentWritten(
  {
    document: 'ships/{shipId}',
    region: 'europe-west1',
  },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    const auditEntry = buildAuditEntry(before, after);
    await writeAuditLog(`ships/${event.params['shipId']}`, auditEntry);
  }
);
