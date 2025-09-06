import { Timestamp } from '@angular/fire/firestore';

export interface UserInterface {
  email: string;
  displayName: string;
  userType: string;
  lastLoginTrip: Timestamp;
  uid: string;

}
