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
      orderBy('boarding', 'desc')
    );

    return from(getDocs(q)).pipe(
      map((snapshot) =>
        snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Charge))
      )
    );
  }
}
