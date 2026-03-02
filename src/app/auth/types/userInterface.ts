import { Timestamp } from '@angular/fire/firestore';

export interface UserInterface {
  email: string;
  displayName: string;
  userType: 'pilot' | 'admin' | 'sfpc' | 'viewer' | 'other';
  /** Which division the pilot belongs to. Only set for userType === 'pilot'. */
  division?: 'In' | 'Out';
  lastLoginTrip?: Timestamp;
  uid: string;
  /** Timestamp when user last viewed Sheet-Info page (for green nav indicator) */
  sheet_info_last_viewed?: Timestamp;
}
