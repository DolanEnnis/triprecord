import { Timestamp } from '@angular/fire/firestore';
import { Port, Source, VisitStatus } from './data.model';

/**
 * Represents a Visit enriched with Trip data and computed fields.
 * 
 * This interface defines the shape of data returned by VisitRepository methods
 * that combine Visit and Trip collections for display purposes.
 * 
 * Used by:
 * - previous-visits component (date range searches)
 * - ships component (ship search results)
 */
export interface EnrichedVisit {
  // Core identifiers
  visitId: string;
  shipId: string;
  shipName: string;
  grossTonnage: number;
  
  // Visit status
  status: VisitStatus;
  initialEta?: Date | null;  // For sorting visits without ETA at the top
  
  // Display fields
  displayDate: Date;  // Primary date for display and sorting
  
  // Inward trip details (when ship arrives)
  arrivedDate?: Date | null;
  inwardPilot?: string;
  inwardPort?: Port | string | null;  // Can include fallback values like 'No Info'
  
  // Outward trip details (when ship departs)
  sailedDate?: Date | null;
  outwardPilot?: string;
  outwardPort?: Port | string | null;  // Can include fallback values like 'No Info'
  
  // Metadata and notes
  note?: string;          // Combined notes from trips or visit
  updatedBy: string;      // User who last updated this visit
  updatedAt: Date;        // Last update timestamp
  source?: Source;        // Source of the information (Sheet, AIS, etc.)
}
