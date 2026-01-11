import { inject, Injectable } from '@angular/core';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  Firestore,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
} from '@angular/fire/firestore';
import { from, map, Observable } from 'rxjs';
import { Charge } from '../../models';
import { AuthService } from '../../auth/auth';

/**
 * ChargeRepository handles all direct data access operations for the '/charges' Firestore collection.
 * 
 * DEPENDENCY INJECTION:
 * - All dependencies (firestore, authService) are injected via field initializers
 * - Field initializers run in an injection context automatically
 * - No need for runInInjectionContext in methods unless we call inject() there
 * - We don't call inject() in any methods, so no runInInjectionContext needed!
 */
@Injectable({
  providedIn: 'root',
})
export class ChargeRepository {
  private readonly firestore: Firestore = inject(Firestore);
  private readonly authService: AuthService = inject(AuthService);

  /**
   * Fetches charge documents from the last 60 days.
   * 
   * NO runInInjectionContext NEEDED:
   * - We're not calling inject() anywhere in this method
   * - this.firestore was already injected in the field initializer
   * - Observable pipes don't need injection context
   */
  getRecentCharges(): Observable<Charge[]> {
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
    const sixtyDaysAgoTimestamp = Timestamp.fromDate(sixtyDaysAgo);

    const chargesRef = collection(this.firestore, 'charges');
    const q = query(
      chargesRef,
      where('boarding', '>=', sixtyDaysAgoTimestamp),
      where('boarding', '<=', Timestamp.now()),
      orderBy('boarding', 'desc')
    );

    return from(getDocs(q)).pipe(
      map((snapshot) =>
        snapshot.docs.map((doc): Charge => {
          const data = doc.data();
          const boardingDate = data['boarding'] && typeof data['boarding'].toDate === 'function' ? data['boarding'].toDate() : new Date();
          const updateDate = data['updateTime'] && typeof data['updateTime'].toDate === 'function' ? data['updateTime'].toDate() : new Date();

          return {
            id: doc.id,
            ship: data['ship'],
            gt: data['gt'],
            port: data['port'],
            pilot: data['pilot'],
            typeTrip: data['typeTrip'],
            sailingNote: data['sailingNote'] || data['note'] || '',
            extra: data['extra'],
            boarding: boardingDate,
            updateTime: updateDate,
            createdBy: data['createdBy'] || '',
            createdById: data['createdById'] || '',
          };
        })
      )
    );
  }

  /**
   * NO runInInjectionContext NEEDED:
   * - this.firestore already injected
   * - this.authService already injected  
   * - No inject() calls in method body
   */
  async addCharge(chargeData: Omit<Charge, 'updateTime' | 'createdBy' | 'createdById'>): Promise<void> {
    const chargesCollection = collection(this.firestore, 'charges');
    const user = this.authService.currentUserSig();
    const newCharge = {
      ...chargeData,
      updateTime: serverTimestamp(),
      createdBy: user?.displayName || 'Unknown',
      createdById: user?.uid || 'Unknown',
    };
    await addDoc(chargesCollection, newCharge);
  }

  async updateCharge(chargeId: string, chargeData: Partial<Charge>): Promise<void> {
    const chargeDocRef = doc(this.firestore, `charges/${chargeId}`);
    const user = this.authService.currentUserSig();
    await updateDoc(chargeDocRef, {
      ...chargeData,
      updateTime: serverTimestamp(),
      createdBy: user?.displayName || 'Unknown',
      createdById: user?.uid || 'Unknown',
    });
  }

  async deleteCharge(chargeId: string): Promise<void> {
    const chargeDocRef = doc(this.firestore, `charges/${chargeId}`);
    await deleteDoc(chargeDocRef);
  }

  async doesChargeExist(chargeData: { ship: string; boarding: Date; typeTrip: string }): Promise<boolean> {
    const chargesCollection = collection(this.firestore, 'charges');

    const startOfDay = new Date(chargeData.boarding);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(chargeData.boarding);
    endOfDay.setHours(23, 59, 59, 999);

    const q = query(
      chargesCollection,
      where('ship', '==', chargeData.ship),
      where('typeTrip', '==', chargeData.typeTrip),
      where('boarding', '>=', startOfDay),
      where('boarding', '<=', endOfDay)
    );

    const querySnapshot = await getDocs(q);
    return !querySnapshot.empty;
  }
}
