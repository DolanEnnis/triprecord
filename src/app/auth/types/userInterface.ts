import { Timestamp } from '@angular/fire/firestore';

export interface UserInterface {
  email: string;
  displayName: string;
  userType:'pilot' | 'admin' | 'sfpc' | 'other'
  lastLoginTrip?: Timestamp;
  uid: string;

}
