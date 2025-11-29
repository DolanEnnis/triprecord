import {
  inject,
  Injectable,
  Injector,
  runInInjectionContext,
} from '@angular/core';
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
import { StatusListRow } from '../models/status-list.model'; // 1. Make sure this is imported

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
      const visitsCollection = collection(
        this.firestore,
        this.VISITS_COLLECTION
      );
      const docRef = await addDoc(visitsCollection, visit);
      return docRef.id;
    });
  }

  getVisitById(visitId: string): Observable<Visit | undefined> {
    return runInInjectionContext(this.injector, () => {
      const visitDocRef = doc(
        this.firestore,
        `${this.VISITS_COLLECTION}/${visitId}`
      );
      return from(getDoc(visitDocRef)).pipe(
        map((docSnap) =>
          docSnap.exists() ? (docSnap.data() as Visit) : undefined
        )
      );
    });
  }

  getPreviousVisits(shipId: string): Observable<Visit[]> {
    return runInInjectionContext(this.injector, () => {
      const visitsCollection = collection(
        this.firestore,
        this.VISITS_COLLECTION
      );
      const visitsQuery = query(
        visitsCollection,
        where('shipId', '==', shipId),
        orderBy('initialEta', 'desc')
      );

      return (
        collectionData(visitsQuery, { idField: 'id' }) as Observable<Visit[]>
      ).pipe(
        switchMap((visits) => {
          if (visits.length === 0) {
            return of([]);
          }

          const visitsWithPilots$ = visits.map((visit) => {
            const tripsCollection = collection(
              this.firestore,
              this.TRIPS_COLLECTION
            );
            const inwardTripQuery = query(
              tripsCollection,
              where('visitId', '==', visit.id),
              where('typeTrip', '==', 'In'),
              limit(1)
            );

            return from(getDocs(inwardTripQuery)).pipe(
              map((tripSnapshot) => {
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

  async updateVisitStatus(
    visitId: string,
    newStatus: VisitStatus,
    updatedBy: string
  ): Promise<void> {
    return runInInjectionContext(this.injector, async () => {
      const visitDocRef = doc(
        this.firestore,
        `${this.VISITS_COLLECTION}/${visitId}`
      );
      await updateDoc(visitDocRef, {
        currentStatus: newStatus,
        statusLastUpdated: serverTimestamp(),
        updatedBy: updatedBy,
      });
    });
  }

  /**
   * Fetches visits with a specific status and "joins" the relevant Trip data.
   * - Status 'Due'/'Awaiting Berth' -> Joins with 'In' trip.
   * - Status 'Alongside'/'Sailed'   -> Joins with 'Out' trip.
   */
  getVisitsWithTripDetails(status: VisitStatus): Observable<StatusListRow[]> {
    return runInInjectionContext(this.injector, () => {
      const visitsCollection = collection(
        this.firestore,
        this.VISITS_COLLECTION
      );

      // 1. Fetch Visits by Status
      const visitsQuery = query(
        visitsCollection,
        where('currentStatus', '==', status),
        orderBy('initialEta', 'asc') // Order by ETA by default
      );

      return (
        collectionData(visitsQuery, { idField: 'id' }) as Observable<Visit[]>
      ).pipe(
        switchMap((visits) => {
          if (visits.length === 0) return of([]);

          // 2. For each visit, fetch the relevant trip
          const joinedRows$ = visits.map((visit) => {
            // Determine which trip type to look for based on status logic
            const targetTripType =
              status === 'Alongside' || status === 'Sailed' ? 'Out' : 'In';

            const tripsCollection = collection(
              this.firestore,
              this.TRIPS_COLLECTION
            );
            const tripQuery = query(
              tripsCollection,
              where('visitId', '==', visit.id),
              where('typeTrip', '==', targetTripType),
              limit(1)
            );

            return from(getDocs(tripQuery)).pipe(
              map((snapshot) => {
                let tripData: Trip | undefined;
                if (!snapshot.empty) {
                  tripData = snapshot.docs[0].data() as Trip;
                }

                // 3. Map to the clean View Model (StatusListRow)

                // Safe Date Conversions:
                let activeDate: Date;
                if (
                  tripData?.boarding &&
                  tripData.boarding instanceof Timestamp
                ) {
                  activeDate = tripData.boarding.toDate();
                } else if (
                  visit.initialEta &&
                  visit.initialEta instanceof Timestamp
                ) {
                  activeDate = visit.initialEta.toDate();
                } else {
                  activeDate = new Date(); // Fallback if data is corrupt
                }

                const updateDate =
                  visit.statusLastUpdated instanceof Timestamp
                    ? visit.statusLastUpdated.toDate()
                    : new Date();

                return {
                  visitId: visit.id!,
                  shipName: visit.shipName,
                  status: visit.currentStatus,
                  date: activeDate,

                  // Flattened fields (Handling "No Info" logic)
                  port:
                    tripData?.toPort ||
                    tripData?.fromPort ||
                    visit.berthPort ||
                    'No Info',
                  note: tripData?.pilotNotes || visit.visitNotes || '',
                  pilot: tripData?.pilot || visit.inwardPilot || 'Unassigned',

                  updatedBy: visit.updatedBy,
                  updatedAt: updateDate,
                  // Marine Traffic link omitted as requested
                } as StatusListRow;
              })
            );
          });

          return combineLatest(joinedRows$);
        })
      );
    });
  }
}
