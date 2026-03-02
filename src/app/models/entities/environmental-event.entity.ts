import { Timestamp } from '@angular/fire/firestore';

export type EnvironmentalEventType = 
  | 'high' 
  | 'low' 
  | 'dawn'
  | 'dusk'
  | 'boarding_limerick' 
  | 'airport_boarding' 
  | 'standby_airport'
  | 'flood_start_augh' 
  | 'last_xover_augh';

export interface EnvironmentalEvent {
  id?: string;
  timestamp: Timestamp;
  port: 'foynes' | 'tarbert' | 'limerick' | 'solar';
  type: EnvironmentalEventType;
  height: number;
  range?: number | null; // For Foynes only
  dateKey: string;       // YYYY-MM-DD
}
