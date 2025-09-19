import { Timestamp } from '@angular/fire/firestore';

export interface UserInterface {
  email: string;
  displayName: string;
  userType:'Pilot' | 'Admin' | 'sfpc' | 'other'
  lastLoginTrip?: Timestamp;
  uid: string;

}
