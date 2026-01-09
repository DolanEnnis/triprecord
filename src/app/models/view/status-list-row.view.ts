import type { VisitStatus } from '../types';

/**
 * View Model: Flattened table row for the active status list component.
 * 
 * @remarks
 * This view model optimizes Visit + Trip data for display in the status list tables,
 * which show active vessels grouped by status (Due, Awaiting Berth, Alongside).
 * 
 * **Data Join Strategy by Status:**
 * - `Due` / `Awaiting Berth` → Joins with 'In' trip (arrival information)
 * - `Alongside` → Joins with 'Out' trip (departure preparation)
 * 
 * **Date Field Logic:**
 * - `status === 'Due'` → `date` = Visit.initialEta
 * - `status === 'Awaiting Berth'` → `date` = Trip.boarding (ETB) or fallback to ETA
 * - `status === 'Alongside'` → `date` = Trip.boarding (ETS) or fallback to ETA
 * 
 * The `isTimeSet` flag indicates whether the date is actual (from Trip) or estimated (from Visit).
 * 
 * @firestore Derived from: `/visits` + `/trips`
 * 
 * @see {@link Visit} for base entity
 * @see {@link Trip} for joined movement data
 * @see {VisitRepository.getVisitsWithTripDetails} for the join query
 * 
 * @example
 * ```typescript
 * // Ship awaiting berth assignment
 * const row: StatusListRow = {
 *   visitId: 'visit123',
 *   tripId: 'trip456',
 *   shipName: 'MSC Oscar',
 *   status: 'Awaiting Berth',
 *   
 *   // Date from actual trip boarding time
 *   date: new Date('2024-01-15T14:30:00Z'),
 *   isTimeSet: true,  // Pilot boarding time is set
 *   
 *   // Flattened trip data
 *   port: 'Foynes',
 *   note: 'Strong ebb tide',
 *   pilot: 'John Smith',
 *   
 *   // Metadata
 *   updatedBy: 'Port Controller',
 *   updatedAt: new Date('2024-01-15T14:00:00Z'),
 *   source: 'Sheet',
 *   marineTrafficLink: 'https://...'
 * };
 * ```
 */
export interface StatusListRow {
  /** Visit document ID */
  visitId: string;
  
  /** 
   * Trip document ID for the relevant movement.
   * Used for updating trip-specific data (pilot, boarding time, notes).
   */
  tripId?: string;
  
  /** Vessel name */
  shipName: string;
  
  /** Gross Tonnage of the vessel (from Visit entity) */
  grossTonnage?: number;
  
  /** Current visit status (determines which trip is joined) */
  status: VisitStatus;

  /** 
   * Primary date for display and sorting.
   * - For 'Due': initialEta
   * - For 'Awaiting Berth'/'Alongside': Trip.boarding or fallback to initialEta
   */
  date: Date;
  
  /** 
   * Indicates if `date` is from actual trip boarding (`true`) or estimated ETA (`false`).
   * Used for styling (e.g., show estimated dates in italics).
   */
  isTimeSet: boolean;

  /** 
   * Port from Trip or fallback to Visit.berthPort.
   * May be 'No Info' if not recorded.
   */
  port: string;
  
  /** 
   * Combined notes from Trip.pilotNotes or Visit.visitNotes.
   * Empty string if no notes.
   */
  note: string;
  
  /** 
   * Pilot from Trip or fallback to Visit.inwardPilot.
   * May be 'Unassigned' if not yet assigned.
   */
  pilot: string;

  /** User who last updated this visit */
  updatedBy: string;
  
  /** Last update timestamp */
  updatedAt: Date;
  
  /** Source of visit information (optional) */
  source?: string;
  
  /** Link to MarineTraffic or similar tracking service */
  marineTrafficLink?: string | null;
}
