import { inject, Injectable, Injector, runInInjectionContext } from '@angular/core';
import {
  addDoc,
  collection,
  collectionData,
  doc,
  Firestore,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  orderBy,
} from '@angular/fire/firestore';
import { combineLatest, from, Observable, of } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { Trip, Visit, VisitStatus } from '../models/data.model';

@Injectable({
  providedIn: 'root',
})
export class VisitRepository {
  private readonly firestore: Firestore = inject(Firestore);
  private readonly injector = inject(Injector);
  private readonly VISITS_COLLECTION = 'visits_new';
  private readonly TRIPS_COLLECTION = 'trips';

  async addVisit(visit: Omit<Visit, 'id'>): Promise<string> {
    return runInInjectionContext(this.injector, async () => {
      const visitsCollection = collection(this.firestore, this.VISITS_COLLECTION);
      const docRef = await addDoc(visitsCollection, visit);
      return docRef.id;
    });
  }

  getVisitById(visitId: string): Observable<Visit | undefined> {
    return runInInjectionContext(this.injector, () => {
      const visitDocRef = doc(this.firestore, `${this.VISITS_COLLECTION}/${visitId}`);
      return from(getDoc(visitDocRef)).pipe(
        map(docSnap => docSnap.exists() ? docSnap.data() as Visit : undefined)
      );
    });
  }

  getPreviousVisits(shipId: string): Observable<Visit[]> {
    return runInInjectionContext(this.injector, () => {
      const visitsCollection = collection(this.firestore, this.VISITS_COLLECTION);
      const visitsQuery = query(
        visitsCollection,
        where('shipId', '==', shipId),
        orderBy('initialEta', 'desc')
      );

      return (collectionData(visitsQuery, { idField: 'id' }) as Observable<Visit[]>).pipe(
        switchMap(visits => {
          if (visits.length === 0) {
            return of([]);
          }

          const visitsWithPilots$ = visits.map(visit => {
            const tripsCollection = collection(this.firestore, this.TRIPS_COLLECTION);
            const inwardTripQuery = query(
              tripsCollection,
              where('visitId', '==', visit.id),
              where('typeTrip', '==', 'In'),
              limit(1)
            );

            return from(getDocs(inwardTripQuery)).pipe(
              map(tripSnapshot => {
                if (!tripSnapshot.empty) {
                  const inwardTrip = tripSnapshot.docs[0].data() as Trip;
                  return { ...visit, inwardPilot: inwardTrip.pilot };
                }
                return visit; // Return original visit if no 'In' trip is found
              })
            );
          });

          return combineLatest(visitsWithPilots$);
        })
      );
    });
  }

  async updateVisitStatus(visitId: string, newStatus: VisitStatus, updatedBy: string): Promise<void> {
    return runInInjectionContext(this.injector, async () => {
      const visitDocRef = doc(this.firestore, `${this.VISITS_COLLECTION}/${visitId}`);
      await updateDoc(visitDocRef, {
        currentStatus: newStatus,
        statusLastUpdated: serverTimestamp(),
        updatedBy: updatedBy,
      });
    });
  }
}
