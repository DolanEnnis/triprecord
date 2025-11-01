import { inject, Injectable, Injector, runInInjectionContext } from '@angular/core';
import {
  addDoc,
  collection,
  collectionData,
  doc,
  Firestore,
  getDoc,
  query,
  Timestamp,
  where,
} from '@angular/fire/firestore';
import { from, Observable } from 'rxjs';
import {map} from 'rxjs/operators';
import { Visit } from '../models/data.model';

/**
 * VisitRepository handles all direct data access operations for the '/visits' Firestore collection.
 * It's responsible for creating, fetching, and updating visit records.
 */
@Injectable({
  providedIn: 'root',
})
export class VisitRepository {
  private readonly firestore: Firestore = inject(Firestore);
  private readonly injector = inject(Injector);

  async addVisit(visit: Omit<Visit, 'id'>): Promise<string> {
    return runInInjectionContext(this.injector, async () => {
      const visitsCollection = collection(this.firestore, 'visits_new');
      const docRef = await addDoc(visitsCollection, visit);
      return docRef.id;
    });
  }

  getVisitById(visitId: string): Observable<Visit | undefined> {
    return runInInjectionContext(this.injector, () => {
      const visitDocRef = doc(this.firestore, `visits_new/${visitId}`);
      return from(getDoc(visitDocRef)).pipe(
        // Cast to NewVisit or undefined, as data() can return undefined if doc doesn't exist
        // and we don't want to rely on docData which returns Observable<T | undefined>
        // but we need to handle the case where the document might not exist.
        // For simplicity, we'll return undefined if data() is null/undefined.
        // If you need real-time updates, you'd use docData(visitDocRef) directly.
        map(docSnap => docSnap.exists() ? docSnap.data() as Visit : undefined)
      );
    });
  }

  getRecentVisits(threeMonthsAgoTimestamp: Timestamp): Observable<Visit[]> {
    return runInInjectionContext(this.injector, () => {
      const visitsCollection = collection(this.firestore, 'visits_new');
      const recentVisitsQuery = query(
        visitsCollection,
        where('initialEta', '>=', threeMonthsAgoTimestamp)
      );
      return collectionData(recentVisitsQuery, { idField: 'id' }) as Observable<Visit[]>;
    });
  }
}
