import type { Port, Source, VisitStatus } from '../types';

/**
 * View Model: Visit data enriched with related Trip information.
 * 
 * @remarks
 * This view model joins data from {@link Visit} and {@link Trip} collections to create
 * a complete picture of a vessel's port call lifecycle. It combines:
 * - Visit metadata and status
 * - Inward trip details (arrival/berthing)
 * - Outward trip details (departure)
 * - Computed display fields
 * 
 * **Data Sources:**
 * - Base: `/visits` collection
 * - Enrichment: `/trips` collection (where `typeTrip === 'In'` or `'Out'`)
 * - Computation: `displayDate` derived from trip boarding times or ETA
 * 
 * **Why This Exists:**
 * The normalized schema separates Visits and Trips for data integrity, but UI components
 * need a denormalized view showing the complete story. This avoids N+1 queries and
 * complex template logic.
 * 
 * @firestore Derived from: `/visits` + `/trips`
 * 
 * @see {@link Visit} for the base entity
 * @see {@link Trip} for the related movement records
 * @see {VisitRepository.getAllCompletedVisits} for the join query
 * 
 * @example
 * ```typescript
 * const enrichedVisit: EnrichedVisit = {
 *   // Core identifiers
 *   visitId: 'visit123',
 *   shipId: 'ship456',
 *   shipName: 'MSC Oscar',
 *   grossTonnage: 195000,
 *   
 *   // Visit status
 *   status: 'Sailed',
 *   initialEta: new Date('2024-01-15T12:00:00Z'),
 *   
 *   // Display field (most recent relevant date)
 *   displayDate: new Date('2024-01-16T08:30:00Z'),  // Sailing time
 *   
 *   // Inward trip details
 *   arrivedDate: new Date('2024-01-15T14:30:00Z'),
 *   inwardPilot: 'John Smith',
 *   inwardPort: 'Foynes',
 *   
 *   // Outward trip details
 *   sailedDate: new Date('2024-01-16T08:30:00Z'),
 *   outwardPilot: 'Jane Doe',
 *   outwardPort: 'Foynes',
 *   
 *   // Metadata
 *   note: 'Rough seas on departure',
 *   updatedBy: 'Jane Doe',
 *   updatedAt: new Date('2024-01-16T09:00:00Z'),
 *   source: 'Sheet'
 * };
 * ```
 */
export interface EnrichedVisit {
  // ─────────────────────────────────────────────────────────────
  // Core Identifiers
  // ─────────────────────────────────────────────────────────────
  
  /** Visit document ID */
  visitId: string;
  
  /** Referenced ship document ID */
  shipId: string;
  
  /** Vessel name (denormalized) */
  shipName: string;
  
  /** Gross Tonnage (denormalized) */
  grossTonnage: number;
  
  // ─────────────────────────────────────────────────────────────
  // Visit Status
  // ─────────────────────────────────────────────────────────────
  
  /** Current lifecycle status of the visit */
  status: VisitStatus;
  
  /** 
   * Original estimated/actual time of arrival.
   * May be `null` for visits created without an ETA.
   */
  initialEta?: Date | null;
  
  // ─────────────────────────────────────────────────────────────
  // Display Fields (Computed)
  // ─────────────────────────────────────────────────────────────
  
  /** 
   * Primary date for sorting and display.
   * Logic: sailedDate > arrivedDate > initialEta
   */
  displayDate: Date;
  
  // ─────────────────────────────────────────────────────────────
  // Inward Trip Details (Ship Arrival)
  // ─────────────────────────────────────────────────────────────
  
  /** Actual berthing time from inward Trip (null if not yet berthed) */
  arrivedDate?: Date | null;
  
  /** Pilot who brought the ship in */
  inwardPilot?: string;
  
  /** 
   * Berth where ship was placed.
   * May be string 'No Info' if port not recorded.
   */
  inwardPort?: Port | string | null;
  
  // ─────────────────────────────────────────────────────────────
  // Outward Trip Details (Ship Departure)
  // ─────────────────────────────────────────────────────────────
  
  /** Actual sailing time from outward Trip (null if not yet sailed) */
  sailedDate?: Date | null;
  
  /** Pilot who took the ship out */
  outwardPilot?: string;
  
  /** 
   * Port from which ship departed.
   * May be string 'No Info' if port not recorded.
   */
  outwardPort?: Port | string | null;
  
  // ─────────────────────────────────────────────────────────────
  // Metadata and Notes
  // ─────────────────────────────────────────────────────────────
  
  /** Combined notes from trips or visit notes */
  note?: string;
  
  /** User who last updated this visit */
  updatedBy: string;
  
  /** Last update timestamp */
  updatedAt: Date;
  
  /** Source of visit information */
  source?: Source;
}
