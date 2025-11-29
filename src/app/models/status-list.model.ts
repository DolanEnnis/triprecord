import { Timestamp } from '@angular/fire/firestore';

export interface StatusListRow {
  visitId: string;
  shipName: string;
  status: string;      // 'Due', 'Alongside', etc.

  // 1. We convert Firestore Timestamps to JS Dates here.
  //    The HTML will ONLY ever see a JS Date.
  date: Date;

  // 2. These fields are flattened from the joined Trip data
  port: string;
  note: string;
  pilot: string;

  // 3. Metadata
  updatedBy: string;
  updatedAt: Date;
  marineTrafficLink?: string | null;
}
