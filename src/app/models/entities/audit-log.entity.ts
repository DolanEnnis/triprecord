import { Timestamp } from '@angular/fire/firestore';

/**
 * AuditablePayload — the "stamp" that every Firestore write must carry.
 *
 * LEARNING: WHY A CLIENT-SIDE STAMP?
 * The Cloud Function trigger fires AFTER the write and has access to the
 * document's new data. By attaching these two fields to every payload, the
 * function can identify WHO made the change and from WHERE, without needing
 * a separate API call. The Admin SDK then strips them when building the audit log.
 *
 * The underscore prefix (_) signals these are internal metadata fields —
 * not for display in the UI, and excluded from the diff calculation.
 */
export interface AuditablePayload {
  /** Firebase UID of the user performing the write (e.g. 'abc123xyz') */
  _modifiedBy: string;
  /** Angular Router URL at the time of save (e.g. '/edit/visitId123') */
  _modifiedFrom: string;
}

/**
 * AuditLog — the shape of a single document in any `audit_logs` subcollection.
 *
 * DELTA FORMAT (new logs):
 *   Stores only the fields that changed via the `changes` map.
 *   Each entry: { old: previousValue, new: updatedValue }
 *
 * BACKWARDS COMPATIBLE:
 *   Full-state logs written before this migration had `previousState` and
 *   `newState` instead. Both are optional so old data still type-checks.
 *
 * @firestore Path: `/{collection}/{docId}/audit_logs/{logId}`
 */
export interface AuditLog {
  /** Firestore document ID (auto-set on retrieval) */
  id?: string;

  /**
   * Server-generated timestamp.
   *
   * LEARNING: Typed as Timestamp because FieldValue.serverTimestamp() is only
   * used at write time (inside the Cloud Function). By the time the client
   * reads the document via getDocs(), Firestore has already resolved it to
   * a concrete Timestamp value.
   */
  timestamp: Timestamp;

  /** Whether this was a document creation, modification, or deletion */
  action: 'CREATE' | 'UPDATE' | 'DELETE';

  /** Firebase UID of the user who triggered the change (or 'system') */
  modifiedBy: string;

  /**
   * Angular route that triggered the write (or 'system' for Cloud Functions).
   * Example: '/edit/abc123', '/new-visit'
   */
  modifiedFrom: string;

  /**
   * DELTA FORMAT — map of fields that changed.
   * Only present on UPDATE log entries. The key is the field name.
   *
   * Example:
   *   { pilot: { old: 'John Murphy', new: 'Mary Walsh' },
   *     boarding: { old: '2024-01-01T10:00', new: '2024-01-01T11:00' } }
   */
  changes?: Record<string, { old: unknown; new: unknown }>;

  // ── Legacy full-state fields (backwards compatibility only) ──────────────
  // These existed before the delta migration. New logs will NOT have these.
  // The UI checks for `changes` first and falls back to these if absent.
  /** @deprecated Use `changes` instead */
  previousState?: Record<string, unknown> | null;
  /** @deprecated Use `changes` instead */
  newState?: Record<string, unknown> | null;
}
