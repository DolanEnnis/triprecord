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

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

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
function calculateDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): Record<string, { old: unknown; new: unknown }> {
  const changes: Record<string, { old: unknown; new: unknown }> = {};

  // Collect all unique keys from both snapshots
  const allKeys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);

  allKeys.forEach(key => {
    // Skip the internal audit hint fields — they're plumbing, not data.
    // Including them would create noise like: { _modifiedBy: { old: 'uid1', new: 'uid1' } }
    if (key === '_modifiedBy' || key === '_modifiedFrom') return;

    const beforeVal = before?.[key];
    const afterVal  = after?.[key];

    // JSON.stringify gives us a safe deep comparison for nested Firestore payloads
    if (JSON.stringify(beforeVal) !== JSON.stringify(afterVal)) {
      changes[key] = {
        old: beforeVal ?? null,
        new: afterVal  ?? null,
      };
    }
  });

  return changes;
}

// ----------------------------------------------------------------
// STEP 2: Determine the action type from before/after existence
// ----------------------------------------------------------------
type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE';

function resolveAction(
  before: Record<string, unknown> | undefined,
  after:  Record<string, unknown> | undefined
): AuditAction {
  if (!before) return 'CREATE';
  if (!after)  return 'DELETE';
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
async function processAuditEvent(
  parentPath: string,
  before: Record<string, unknown> | undefined,
  after:  Record<string, unknown> | undefined,
  expiresAt?: Date
): Promise<void> {
  const action = resolveAction(before, after);

  // Extract the hint fields — present in the 'after' state for CREATE/UPDATE,
  // or the 'before' state for DELETE (after is undefined on delete)
  const hintSource = after ?? before ?? {};
  const modifiedBy:   string = String(hintSource['_modifiedBy']   ?? 'system');
  const modifiedFrom: string = String(hintSource['_modifiedFrom'] ?? 'system');

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

  let auditRecord: Record<string, unknown>;

  if (action === 'UPDATE') {
    // DELTA LOGGING: only store what changed
    const changes = calculateDiff(
      before as Record<string, unknown>,
      after  as Record<string, unknown>
    );

    // GHOST SAVE DETECTION: if nothing changed, abort — zero Firestore cost
    if (Object.keys(changes).length === 0) {
      console.log(`[AuditEngine] Ghost save detected on ${parentPath} — no changes, skipping log.`);
      return;
    }

    auditRecord = {
      timestamp:    FieldValue.serverTimestamp(),
      action:       'UPDATE',
      modifiedBy,
      modifiedFrom,
      changes,
      ...ttlField,  // expiresAt only present when TTL is requested
    };
  } else {
    // CREATE or DELETE — no meaningful diff to show.
    auditRecord = {
      timestamp:    FieldValue.serverTimestamp(),
      action,
      modifiedBy,
      modifiedFrom,
      ...ttlField,
    };
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
export const onTripWritten = onDocumentWritten(
  { document: 'trips/{tripId}', region: 'europe-west1' },
  async (event) => {
    const before = event.data?.before?.data() as Record<string, unknown> | undefined;
    const after  = event.data?.after?.data()  as Record<string, unknown> | undefined;

    // Compute a date exactly 1 year from now for the TTL field.
    // Firestore's TTL daemon will delete this audit log document automatically
    // once this date passes (requires TTL policy enabled in Firestore console).
    const oneYearFromNow = new Date();
    oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);

    await processAuditEvent(`trips/${event.params['tripId']}`, before, after, oneYearFromNow);
  }
);

/**
 * Logs every write to the `visits_new` collection.
 * UPDATE log path: `visits_new/{visitId}/audit_logs/{autoId}`
 */
export const onVisitWritten = onDocumentWritten(
  { document: 'visits_new/{visitId}', region: 'europe-west1' },
  async (event) => {
    const before = event.data?.before?.data() as Record<string, unknown> | undefined;
    const after  = event.data?.after?.data()  as Record<string, unknown> | undefined;
    await processAuditEvent(`visits_new/${event.params['visitId']}`, before, after);
  }
);

/**
 * Logs every write to the `ships` collection.
 * UPDATE log path: `ships/{shipId}/audit_logs/{autoId}`
 */
export const onShipWritten = onDocumentWritten(
  { document: 'ships/{shipId}', region: 'europe-west1' },
  async (event) => {
    const before = event.data?.before?.data() as Record<string, unknown> | undefined;
    const after  = event.data?.after?.data()  as Record<string, unknown> | undefined;
    await processAuditEvent(`ships/${event.params['shipId']}`, before, after);
  }
);
