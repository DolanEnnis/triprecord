import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  query,
  where,
  Timestamp,
  getDocs,
  orderBy,
} from '@angular/fire/firestore';
import { from, map, Observable } from 'rxjs';
import { Charge } from '../models/trip.model';

@Injectable({ providedIn: 'root' })
export class ChargesService {
  private firestore = inject(Firestore);

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
            note: data['note'],
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
}
