import type { PdfShip } from './pdf-ship.view';
import type { EnrichedVisit } from './enriched-visit.view';

/**
 * Type of match when reconciling PDF ships with system visits.
 * 
 * @remarks
 * - `pdf-only`: Ship appears in PDF but not in our system (needs to be added)
 * - `matched`: Ship exists in both sources with matching data
 * - `mismatch`: Ship exists in both but has different ETA, status, or port
 * - `system-only`: Ship in our system but not in PDF (may have sailed, been cancelled, or PDF error)
 */
export type ReconciliationMatchType = 
  | 'pdf-only'      
  | 'matched'       
  | 'mismatch'      
  | 'system-only';

/**
 * Represents a discrepancy between PDF data and system data for a specific field.
 */
export interface FieldDiscrepancy {
  /** The field that differs */
  field: 'name' | 'eta' | 'status' | 'port';
  
  /** Value from the PDF */
  pdfValue: string;
  
  /** Value from our system */
  systemValue: string;
}

/**
 * Result of comparing a ship between the PDF and our database.
 * 
 * @remarks
 * This is the core data structure for the reconciliation feature.
 * Each result represents one ship and how it matches (or doesn't match)
 * between the CarGoPro PDF and our internal visit records.
 * 
 * **Display Priority (in Action Required section):**
 * 1. `pdf-only` ships (not in our system) - HIGHEST PRIORITY
 * 2. `mismatch` ships (differences found) - Medium priority
 * 3. `matched` ships - Display separately in "All Good" section
 * 4. `system-only` ships - Display at bottom in "Our Records Only"
 * 
 * @example
 * ```typescript
 * // Ship only in PDF (needs to be added to our system)
 * const pdfOnly: ReconciliationResult = {
 *   matchType: 'pdf-only',
 *   pdfShip: { name: 'MSC OSCAR', ... },
 *   systemVisit: null,
 *   discrepancies: [],
 *   shipName: 'MSC OSCAR'
 * };
 * 
 * // Ship with mismatched ETA
 * const mismatch: ReconciliationResult = {
 *   matchType: 'mismatch',
 *   pdfShip: { name: 'KARIM', eta: '2026-01-03T10:00:00Z', ... },
 *   systemVisit: { ship_name: 'Karim', eta: Timestamp(2026-01-03T14:00:00Z), ... },
 *   discrepancies: [
 *     { field: 'eta', pdfValue: '2026-01-03T10:00:00Z', systemValue: '2026-01-03T14:00:00Z' }
 *   ],
 *   shipName: 'KARIM'
 * };
 * ```
 */
export interface ReconciliationResult {
  /** Type of match detected */
  matchType: ReconciliationMatchType;
  
  /** PDF ship data (null if system-only) */
  pdfShip: PdfShip | null;
  
  /** System visit data (null if pdf-only) - using StatusListRow which includes trip data */
  systemVisit: import('./status-list-row.view').StatusListRow | null;
  
  /** List of field discrepancies (empty if matched or only in one source) */
  discrepancies: FieldDiscrepancy[];
  
  /** Normalized ship name for display (uses PDF name if available, otherwise system name) */
  shipName: string;
}
