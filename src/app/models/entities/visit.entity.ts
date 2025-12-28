import { FieldValue, Timestamp } from '@angular/fire/firestore';
import type { Port, VisitStatus, Source } from '../types';

/**
 * Visit entity representing a ship's port call lifecycle (state machine).
 * 
 * @remarks
 * A Visit tracks the overall status and timeline of a ship's stay in port.
 * It acts as the parent container for all related {@link Trip} documents.
 * 
 * **State Machine Flow:**
 * - `Due` → Ship is expected to arrive
 * - `Awaiting Berth` → Ship has arrived, waiting for berth assignment
 * - `Alongside` → Ship is berthed
 * - `Sailed` → Ship has departed
 * - `Cancelled` → Visit was cancelled
 * 
 * @firestore Collection path: `/visits_new`
 * 
 * @see {@link Trip} for individual pilot movements
 * @see {@link VisitStatus} for valid status values
 * 
 * @example
 * ```typescript
 * const visit: Visit = {
 *   shipId: 'abc123',
 *   shipName: 'MSC Oscar',
 *   grossTonnage: 195000,
 *   currentStatus: 'Due',
 *   initialEta: Timestamp.fromDate(new Date('2024-01-15T14:00:00Z')),
 *   berthPort: 'Foynes',
 *   inwardPilot: 'John Smith',
 *   statusLastUpdated: serverTimestamp(),
 *   updatedBy: 'Port Controller',
 *   source: 'Sheet'
 * };
 * ```
 */
export interface Visit {
  /** Firestore document ID (auto-generated) */
  id?: string;
  
  /** Foreign key reference to the {@link Ship} document */
  shipId: string;

  /** Denormalized ship name for query optimization */
  shipName: string;
  
  /** Denormalized gross tonnage for display/filtering */
  grossTonnage: number;

  /** Current state of the visit in the lifecycle */
  currentStatus: VisitStatus;
  
  /** Ship's estimated/actual time of arrival at the port */
  initialEta: Timestamp;
  
  /** Port where the ship is berthed or will berth */
  berthPort?: Port | null;
  
  /** Pilot assigned to bring the ship in (denormalized from inward Trip) */
  inwardPilot?: string;

  /** Timestamp of the last status change */
  statusLastUpdated: Timestamp | FieldValue;
  
  /** User who last updated this visit (display name or 'System') */
  updatedBy: string;
  
  /** Free-text notes specific to this port call */
  visitNotes?: string | null;
  
  /** Source of the visit information (e.g., 'Sheet', 'AIS', 'Agent') */
  source?: Source;
}
