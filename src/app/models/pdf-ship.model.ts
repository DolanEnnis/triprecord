/**
 * Represents a ship extracted from the CarGoPro Daily Diary PDF.
 * This data is parsed using AI from the daily PDF and cached in Firestore.
 */
export interface PdfShip {
  /** Ship name as it appears in the PDF */
  name: string;
  
  /** Gross Tonnage */
  gt: number;
  
  /** Port name (e.g., 'Shannon', 'Foynes') */
  port: string;
  
  /** Estimated Time of Arrival in ISO datetime format, null if not available */
  eta: string | null;
  
  /** Current status of the ship */
  status: 'Due' | 'Awaiting Berth' | 'Alongside';
  
  /** Source identifier from the PDF */
  source: string;
}
