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
 * The underscore prefix (_) is a strong convention signalling these are
 * internal metadata fields — not for display in the UI.
 */
export interface AuditablePayload {
  /** Firebase UID of the user performing the write (e.g. 'abc123xyz') */
  _modifiedBy: string;
  /** Angular Router URL at the time of save (e.g. '/edit/visitId123') */
  _modifiedFrom: string;
}

/**
 * AuditLog<T> — the shape of a single document in any `audit_logs` subcollection.
 *
 * The generic `T` lets us type the before/after snapshots:
 * - AuditLog<Trip> for trips
 * - AuditLog<Visit> for visits_new
 * - AuditLog<Ship> for ships
 *
 * @firestore Path: `/{collection}/{docId}/audit_logs/{logId}`
 */
export interface AuditLog<T = Record<string, unknown>> {
  /** Firestore document ID (auto-set on retrieval) */
  id?: string;

  /**
   * Server-generated timestamp — guarantees correct ordering even if clocks drift.
   *
   * LEARNING: WHY TIMESTAMP (not FieldValue) here?
   * FieldValue.serverTimestamp() is only used during the WRITE (in the Cloud Function).
   * By the time client code reads the document via getDocs(), Firestore has already
   * resolved the sentinel to a concrete Timestamp. So the read-side type is Timestamp.
   */
  timestamp: Timestamp;


  /** Whether this was a document creation, modification, or deletion */
  action: 'CREATE' | 'UPDATE' | 'DELETE';

  /** Who triggered the write (from _modifiedBy stamp, or 'unknown') */
  modifiedBy: string;

  /**
   * Which Angular route triggered the write (from _modifiedFrom stamp, or 'unknown').
   * Example: '/edit/abc123', '/new-visit', '/trip-confirmation'
   */
  modifiedFrom: string;

  /**
   * The document's state just BEFORE the write.
   * - null on CREATE (no previous state exists)
   * - Populated on UPDATE and DELETE
   * Note: _modifiedBy and _modifiedFrom are stripped from these snapshots.
   */
  previousState: Omit<T, '_modifiedBy' | '_modifiedFrom'> | null;

  /**
   * The document's state just AFTER the write.
   * - null on DELETE
   * - Populated on CREATE and UPDATE
   * Note: _modifiedBy and _modifiedFrom are stripped from these snapshots.
   */
  newState: Omit<T, '_modifiedBy' | '_modifiedFrom'> | null;
}
