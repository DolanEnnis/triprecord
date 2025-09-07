import { Timestamp } from '@angular/fire/firestore';

export interface Charge {
  id: string; // The Firestore document ID
  boarding: Timestamp;
  docid: string;
  extra: string | null;
  gt: number;
  note: string | null;
  pilot: string;
  port: string;
  ship: string;
  typeTrip: string;
  updateTime: number;
  visitid: string;
}
