import type { VisitStatus } from '../types';

/**
 * View Model: Ship data extracted from the CarGoPro Daily Diary PDF.
 * 
 * @remarks
 * The CarGoPro Daily Diary is an external PDF document listing expected vessel arrivals
 * and current berth status. This view model represents data extracted from that PDF using
 * AI-powered parsing and cached in Firestore for reconciliation with internal records.
 * 
 * **Key Differences from {@link Visit}:**
 * - Data source is external (CarGoPro) vs. internal (Pilots/Port Authority)
 * - ETA is string (ISO format from PDF) vs. Timestamp
 * - Status cannot be 'Sailed' or 'Cancelled' (PDF only shows active arrivals)
 * - No pilot assignments or detailed trip information
 * 
 * **Use Cases:**
 * - Sheet-info page: Compare PDF data with internal visit records
 * - Data quality checks: Flag discrepancies between sources
 * - Missing visit detection: Identify ships in PDF not in system
 * 
 * @firestore Collection path: `/pdf_ships` (cached daily)
 * 
 * @see {@link Visit} for internal visit records
 * @see {SheetInfoComponent} for the reconciliation UI
 * 
 * @example
 * ```typescript
 * const pdfShip: PdfShip = {
 *   name: 'MSC OSCAR',  // Name as it appears in PDF (may differ in casing)
 *   gt: 195000,
 *   port: 'Foynes',
 *   eta: '2024-01-15T14:00:00Z',  // ISO string from PDF
 *   status: 'Due',  // Can only be Due, Awaiting Berth, or Alongside
 *   source: 'CarGoPro Daily Diary'
 * };
 * ```
 */
export interface PdfShip {
  /** 
   * Ship name exactly as it appears in the PDF.
   * Note: May differ in capitalization/spelling from internal records.
   */
  name: string;
  
  /** Gross Tonnage from PDF */
  gt: number;
  
  /** Port name from PDF (e.g., 'Shannon', 'Foynes', 'Aughinish') */
  port: string;
  
  /** 
   * Estimated Time of Arrival in ISO 8601 format.
   * `null` if PDF doesn't specify an ETA (e.g., ship already alongside).
   */
  eta: string | null;
  
  /** 
   * Current status of the ship.
   * Limited to active statuses - PDF doesn't include sailed/cancelled vessels.
   */
  status: Exclude<VisitStatus, 'Sailed' | 'Cancelled'>;
  
  /** Source identifier (typically 'CarGoPro Daily Diary') */
  source: string;
}
