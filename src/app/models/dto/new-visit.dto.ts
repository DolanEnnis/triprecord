import type { Port, Source } from '../types';

/**
 * Data Transfer Object for creating a new vessel visit.
 * 
 * @remarks
 * This DTO aggregates all form inputs needed to initialize a complete visit workflow.
 * When submitted, it triggers the creation of up to three documents:
 * 
 * 1. **Ship** - Created/updated in `/ships` if vessel is new or data changed
 * 2. **Visit** - Created in `/visits_new` with status 'Due'
 * 3. **Trip** - Created in `/trips` for the inward movement (with `boarding = null`)
 * 
 * **Form → Database Transformation:**
 * - `initialEta` (Date) → Converted to Firestore Timestamp
 * - `shipName` → Normalized to `shipName_lowercase` for searching
 * - All nullable fields preserved as-is
 * 
 * @see {@link Ship} for the ship entity created
 * @see {@link Visit} for the visit entity created
 * @see {@link Trip} for the trip entity created
 * @see {VisitWorkflowService.createNewVisit} for the creation logic
 * 
 * @example
 * ```typescript
 * const formData: NewVisitData = {
 *   // Ship information
 *   shipName: 'MSC Oscar',
 *   grossTonnage: 195000,
 *   imoNumber: 9703291,
 *   marineTrafficLink: 'https://www.marinetraffic.com/...',
 *   shipNotes: 'Regular caller',
 *   
 *   // Visit information
 *   initialEta: new Date('2024-01-15T14:00:00Z'),
 *   berthPort: 'Foynes',
 *   visitNotes: 'Container discharge',
 *   source: 'Sheet',
 *   
 *   // Trip information
 *   pilot: 'John Smith'
 * };
 * ```
 */
export interface NewVisitData {
  // ─────────────────────────────────────────────────────────────
  // Ship Details (for `/ships` collection)
  // ─────────────────────────────────────────────────────────────
  
  /** Official vessel name */
  shipName: string;
  
  /** Gross Tonnage for fee calculations */
  grossTonnage: number;
  
  /** IMO number (optional, but recommended for unique identification) */
  imoNumber: number | null;
  
  /** URL to vessel tracking service */
  marineTrafficLink: string | null;
  
  /** General notes about the vessel */
  shipNotes: string | null;

  // ─────────────────────────────────────────────────────────────
  // Visit Details (for `/visits_new` collection)
  // ─────────────────────────────────────────────────────────────
  
  /** 
   * Ship's estimated time of arrival.
   * Will be converted to Firestore Timestamp during persistence.
   */
  initialEta: Date;
  
  /** Port where the ship will berth */
  berthPort: Port | null;
  
  /** Notes specific to this port call */
  visitNotes: string | null;
  
  /** Source of this visit information (Sheet, AIS, Agent, etc.) */
  source: Source;

  // ─────────────────────────────────────────────────────────────
  // Trip Details (for `/trips` collection - initial 'In' movement)
  // ─────────────────────────────────────────────────────────────
  
  /** Pilot assigned to bring the ship in (optional at creation time) */
  pilot?: string;
}
