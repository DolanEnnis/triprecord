import { Timestamp } from '@angular/fire/firestore';
import { VisitStatus } from './data.model';

export interface StatusListRow {
  visitId: string;
  tripId?: string;     // Added for updating trip-specific data
  shipName: string;
  status: VisitStatus; // Properly typed status field instead of generic string

  // 1. We convert Firestore Timestamps to JS Dates here.
  //    The HTML will ONLY ever see a JS Date.
  date: Date;
  isTimeSet: boolean;  // True if the date is from trip.boarding, false if fallback to ETA

  // 2. These fields are flattened from the joined Trip data
  port: string;
  note: string;
  pilot: string;

  // 3. Metadata
  updatedBy: string;
  updatedAt: Date;
  source?: string; // Added for update source tracking
  marineTrafficLink?: string | null;
}
