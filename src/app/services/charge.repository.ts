import { inject, Injectable, Injector, runInInjectionContext } from '@angular/core';
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
import { Charge } from '../models';
import { AuthService } from '../auth/auth';


/**
 * ChargeRepository handles all direct data access operations for the '/charges' Firestore collection.
 * It's responsible for creating, fetching, updating, and deleting charge records.
 */
@Injectable({
  providedIn: 'root',
})
export class ChargeRepository {
  private readonly firestore: Firestore = inject(Firestore);
  private readonly authService: AuthService = inject(AuthService);
  private readonly injector = inject(Injector);

  /**
   * Fetches charge documents from the last 60 days.
   */
  getRecentCharges(): Observable<Charge[]> {
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
    const sixtyDaysAgoTimestamp = Timestamp.fromDate(sixtyDaysAgo);

    const chargesRef = collection(this.firestore, 'charges');
    const q = query(
      chargesRef,
      where('boarding', '>=', sixtyDaysAgoTimestamp),
      where('boarding', '<=', Timestamp.now()), // Exclude future-dated charges
      orderBy('boarding', 'desc')
    );

    return from(getDocs(q)).pipe(
      map((snapshot) =>
        snapshot.docs.map((doc): Charge => {
          const data = doc.data();
          // Manually construct the Charge object, converting Timestamps to Dates. We include a
          // check for the existence of the .toDate method to handle potential data
          // inconsistencies where a field might not be a Firestore Timestamp.
          const boardingDate = data['boarding'] && typeof data['boarding'].toDate === 'function' ? data['boarding'].toDate() : new Date();
          const updateDate = data['updateTime'] && typeof data['updateTime'].toDate === 'function' ? data['updateTime'].toDate() : new Date();

          return {
            id: doc.id,
            ship: data['ship'],
            gt: data['gt'],
            port: data['port'],
            pilot: data['pilot'],
            typeTrip: data['typeTrip'],
            // Handle legacy `note` field and new `sailingNote` field for backward compatibility.
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

  async addCharge(chargeData: Omit<Charge, 'updateTime' | 'createdBy' | 'createdById'>): Promise<void> {
    return runInInjectionContext(this.injector, async () => {
      const chargesCollection = collection(this.firestore, 'charges');
      const user = this.authService.currentUserSig();
      const newCharge = {
        ...chargeData,
        updateTime: serverTimestamp(),
        createdBy: user?.displayName || 'Unknown',
        createdById: user?.uid || 'Unknown',
      };
      await addDoc(chargesCollection, newCharge);
    });
  }

  async updateCharge(chargeId: string, chargeData: Partial<Charge>): Promise<void> {
    return runInInjectionContext(this.injector, async () => {
      const chargeDocRef = doc(this.firestore, `charges/${chargeId}`);
      const user = this.authService.currentUserSig();
      await updateDoc(chargeDocRef, {
        ...chargeData,
        updateTime: serverTimestamp(),
        createdBy: user?.displayName || 'Unknown',
        createdById: user?.uid || 'Unknown',
      });
    });
  }

  async deleteCharge(chargeId: string): Promise<void> {
    return runInInjectionContext(this.injector, async () => {
      const chargeDocRef = doc(this.firestore, `charges/${chargeId}`);
      await deleteDoc(chargeDocRef);
    });
  }

  async doesChargeExist(chargeData: { ship: string; boarding: Date; typeTrip: string }): Promise<boolean> {
    return runInInjectionContext(this.injector, async () => {
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
    });
  }
}
