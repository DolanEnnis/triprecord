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
import { map, switchMap, catchError } from 'rxjs/operators';
import { Trip, Visit, VisitStatus } from '../models/data.model';
import { StatusListRow } from '../models/status-list.model';
import { EnrichedVisit } from '../models/enriched-visit.model';

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
        switchMap((visits: Visit[]) => {
          if (visits.length === 0) {
            return of([]);
          }

          const visitsWithPilots$ = visits.map((visit: Visit) => {
            return runInInjectionContext(this.injector, () => {
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

  async updateVisitLocation(
    visitId: string,
    newPort: any, // Using any to avoid circular dependency if Port is not imported, but better to import Port
    updatedBy: string
  ): Promise<void> {
    return runInInjectionContext(this.injector, async () => {
      const visitDocRef = doc(
        this.firestore,
        `${this.VISITS_COLLECTION}/${visitId}`
      );
      await updateDoc(visitDocRef, {
        berthPort: newPort,
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
        where('currentStatus', '==', status)
        // orderBy('initialEta', 'asc') - Removed to avoid index requirement and allow sorting by effective date
      );

      return (
        collectionData(visitsQuery, { idField: 'id' }) as Observable<Visit[]>
      ).pipe(
        switchMap((visits) => {
          if (visits.length === 0) return of([]);

          // 2. For each visit, fetch the relevant trip
          const joinedRows$ = visits.map((visit) => {
            return runInInjectionContext(this.injector, () => {
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
                  let isTimeSet = false; // Track if the time is actually set or a fallback
                  
                  if (
                    tripData?.boarding &&
                    tripData.boarding instanceof Timestamp
                  ) {
                    activeDate = tripData.boarding.toDate();
                    isTimeSet = true; // Boarding time is explicitly set
                  } else if (
                    visit.initialEta &&
                    visit.initialEta instanceof Timestamp
                  ) {
                    activeDate = visit.initialEta.toDate();
                    isTimeSet = false; // Fallback to ETA, not the actual boarding time
                  } else {
                    activeDate = new Date(); // Fallback if data is corrupt
                    isTimeSet = false;
                  }

                  const updateDate =
                    visit.statusLastUpdated instanceof Timestamp
                      ? visit.statusLastUpdated.toDate()
                      : new Date();


                  return {
                    visitId: visit.id!,
                    tripId: tripData?.id, // Populate tripId
                    shipName: visit.shipName,
                    status: visit.currentStatus,
                    date: activeDate,
                    isTimeSet: isTimeSet, // Flag to indicate if time is set

                    // Flattened fields (Handling "No Info" logic)
                    port:
                      tripData?.port ||
                      visit.berthPort ||
                      'No Info',
                    note: tripData?.pilotNotes || visit.visitNotes || '',
                    pilot: tripData?.pilot || visit.inwardPilot || 'Unassigned',

                    updatedBy: visit.updatedBy,
                    updatedAt: updateDate,
                    source: visit.source,
                    // Marine Traffic link omitted as requested
                  } as StatusListRow;
                })
              );
            });
          });

          return combineLatest(joinedRows$).pipe(
            map((rows) => rows.sort((a, b) => a.date.getTime() - b.date.getTime()))
          );
        })
      );
    });
  }

  async updateVisitDate(
    visitId: string,
    tripId: string | undefined, // Kept for backward compatibility but not used
    status: VisitStatus,
    newDate: Date,
    updatedBy: string
  ): Promise<void> {
    return runInInjectionContext(this.injector, async () => {
      // 1. Always update the Visit's audit fields
      const visitDocRef = doc(this.firestore, `${this.VISITS_COLLECTION}/${visitId}`);
      const visitUpdatePayload: any = {
        statusLastUpdated: serverTimestamp(),
        updatedBy: updatedBy,
      };

      // 2. If 'Due', update initialEta on the Visit
      if (status === 'Due') {
        visitUpdatePayload.initialEta = Timestamp.fromDate(newDate);
        await updateDoc(visitDocRef, visitUpdatePayload);
      } else {
        // 3. For 'Awaiting Berth' or 'Alongside', update the correct Trip's boarding time
        // First, update the visit audit fields
        await updateDoc(visitDocRef, visitUpdatePayload);

        // Determine which trip type to update based on status
        const targetTripType = status === 'Alongside' ? 'Out' : 'In';

        // Query for the specific trip type
        const tripsCollection = collection(this.firestore, this.TRIPS_COLLECTION);
        const tripQuery = query(
          tripsCollection,
          where('visitId', '==', visitId),
          where('typeTrip', '==', targetTripType),
          limit(1)
        );

        const tripSnapshot = await getDocs(tripQuery);
        
        if (!tripSnapshot.empty) {
          const tripDocRef = doc(this.firestore, `${this.TRIPS_COLLECTION}/${tripSnapshot.docs[0].id}`);
          await updateDoc(tripDocRef, {
            boarding: Timestamp.fromDate(newDate),
          });
        } else {
          console.warn(`Cannot update date for status ${status}: No ${targetTripType} trip found for visit ${visitId}.`);
          throw new Error(`No ${targetTripType} trip found for this visit.`);
        }
      }
    });
  }

  async updateVisit(visitId: string, data: Partial<Visit>): Promise<void> {
    return runInInjectionContext(this.injector, async () => {
      const visitDocRef = doc(this.firestore, `${this.VISITS_COLLECTION}/${visitId}`);
      await updateDoc(visitDocRef, {
        ...data,
        statusLastUpdated: serverTimestamp()
      });
    });
  }

  /**
   * Get all active visits (Due, Awaiting Berth, Alongside)
   * Used for sheet info and active ship tracking
   */
  getActiveVisits(): Observable<Visit[]> {
    return runInInjectionContext(this.injector, () => {
      const visitsCollection = collection(
        this.firestore,
        this.VISITS_COLLECTION
      );

      const activeStatuses: VisitStatus[] = ['Due', 'Awaiting Berth', 'Alongside'];
      
      const visitsQuery = query(
        visitsCollection,
        where('currentStatus', 'in', activeStatuses),
        orderBy('initialEta', 'asc')
      );

      return collectionData(visitsQuery, { idField: 'id' }) as Observable<Visit[]>;
    });
  }


  getAllCompletedVisits(startDate?: Date, endDate?: Date): Observable<EnrichedVisit[]> {
    return runInInjectionContext(this.injector, () => {
      const visitsCollection = collection(
        this.firestore,
        this.VISITS_COLLECTION
      );

      // Build query constraints based on parameters
      const constraints: any[] = [];
      
      // If date range is provided, filter by it
      if (startDate) {
        constraints.push(where('initialEta', '>=', Timestamp.fromDate(startDate)));
      }
      if (endDate) {
        constraints.push(where('initialEta', '<=', Timestamp.fromDate(endDate)));
      }
      
      // Always order by initialEta descending (most recent first)
      constraints.push(orderBy('initialEta', 'desc'));
      
      // If no date range specified, limit to recent 200 for performance
      if (!startDate && !endDate) {
        constraints.push(limit(200));
      } else {
        // With date range, limit to 500 to prevent excessive queries
        constraints.push(limit(500));
      }

      const visitsQuery = query(visitsCollection, ...constraints);

      return this.executeVisitsQuery(visitsQuery);
    });
  }

  searchVisitsByShip(shipName: string): Observable<EnrichedVisit[]> {
    return runInInjectionContext(this.injector, () => {
      const visitsCollection = collection(
        this.firestore,
        this.VISITS_COLLECTION
      );

      // Search by lowercase ship name for case-insensitive matching
      const searchTerm = shipName.toLowerCase().trim();
      
      // Query for ships that match the search term
      // Note: This requires shipName_lowercase field to be populated
      const visitsQuery = query(
        visitsCollection,
        where('shipName_lowercase', '>=', searchTerm),
        where('shipName_lowercase', '<=', searchTerm + '\uf8ff'),
        orderBy('shipName_lowercase'),
        orderBy('initialEta', 'desc'),
        limit(100)
      );

      return this.executeVisitsQuery(visitsQuery);
    });
  }

  searchVisitsByGT(grossTonnage: number): Observable<EnrichedVisit[]> {
    return runInInjectionContext(this.injector, () => {
      const visitsCollection = collection(
        this.firestore,
        this.VISITS_COLLECTION
      );

      // Query for visits with matching gross tonnage
      const visitsQuery = query(
        visitsCollection,
        where('grossTonnage', '==', grossTonnage),
        orderBy('initialEta', 'desc'),
        limit(100)
      );

      return this.executeVisitsQuery(visitsQuery);
    });
  }

  private executeVisitsQuery(visitsQuery: any): Observable<EnrichedVisit[]> {
    return runInInjectionContext(this.injector, () => {
      return (
        collectionData(visitsQuery, { idField: 'id' }) as Observable<Visit[]>
      ).pipe(
        catchError((error) => {
          console.error('Error fetching visits:', error);
          return of([]);
        }),
        switchMap((visits) => {
          if (visits.length === 0) {
            console.log('No visits found in database');
            return of([]);
          }

          console.log(`Found ${visits.length} visits, fetching trip details...`);

          // For each visit, fetch both In and Out trips
          const enrichedVisits$ = visits.map((visit) => {
            return runInInjectionContext(this.injector, () => {
              const tripsCollection = collection(
                this.firestore,
                this.TRIPS_COLLECTION
              );
              
              // Query for all trips for this visit
              const tripQuery = query(
                tripsCollection,
                where('visitId', '==', visit.id)
              );

              return from(getDocs(tripQuery)).pipe(
                catchError((error) => {
                  console.error(`Error fetching trips for visit ${visit.id}:`, error);
                  return of({ docs: [] } as any);
                }),
                map((snapshot) => {
                  let inTrip: Trip | undefined;
                  let outTrip: Trip | undefined;

                  snapshot.docs.forEach((doc: any) => {
                    const trip = doc.data() as Trip;
                    if (trip.typeTrip === 'In') {
                      inTrip = trip;
                    } else if (trip.typeTrip === 'Out') {
                      outTrip = trip;
                    }
                  });

                  // Determine the primary date (use Out trip boarding if available, otherwise In trip)
                  let displayDate: Date;
                  if (outTrip?.boarding && outTrip.boarding instanceof Timestamp) {
                    displayDate = outTrip.boarding.toDate();
                  } else if (inTrip?.boarding && inTrip.boarding instanceof Timestamp) {
                    displayDate = inTrip.boarding.toDate();
                  } else if (visit.initialEta && visit.initialEta instanceof Timestamp) {
                    displayDate = visit.initialEta.toDate();
                  } else {
                    displayDate = new Date();
                  }

                  const updateDate =
                    visit.statusLastUpdated instanceof Timestamp
                      ? visit.statusLastUpdated.toDate()
                      : new Date();

                  return {
                    visitId: visit.id!,
                    shipId: visit.shipId,
                    shipName: visit.shipName,
                    grossTonnage: visit.grossTonnage,
                    status: visit.currentStatus,
                    initialEta: visit.initialEta instanceof Timestamp ? visit.initialEta.toDate() : null,
                    displayDate: displayDate,
                    
                    // Inward trip details
                    arrivedDate: inTrip?.boarding instanceof Timestamp ? inTrip.boarding.toDate() : null,
                    inwardPilot: inTrip?.pilot || visit.inwardPilot || 'Unassigned',
                    inwardPort: inTrip?.port || visit.berthPort || 'No Info',
                    
                    // Outward trip details
                    sailedDate: outTrip?.boarding instanceof Timestamp ? outTrip.boarding.toDate() : null,
                    outwardPilot: outTrip?.pilot || 'Unassigned',
                    outwardPort: outTrip?.port || 'No Info',
                    
                    // Other details
                    note: inTrip?.pilotNotes || outTrip?.pilotNotes || visit.visitNotes || '',
                    updatedBy: visit.updatedBy,
                    updatedAt: updateDate,
                    source: visit.source,
                  };
                })
              );
            });
          });

          return combineLatest(enrichedVisits$).pipe(
            catchError((error) => {
              console.error('Error combining visit data:', error);
              return of([]);
            }),
            map((visits: EnrichedVisit[]) => {
              // Filter out cancelled visits
              const filteredVisits = visits.filter(v => v.status !== 'Cancelled');
              
              // Sort: visits without ETA first (in any order), then by displayDate descending
              return filteredVisits.sort((a, b) => {
                // If both have no ETA, maintain any order (return 0)
                if (!a.initialEta && !b.initialEta) return 0;
                
                // If only 'a' has no ETA, it goes first (before b)
                if (!a.initialEta) return -1;
                
                // If only 'b' has no ETA, it goes first (before a)
                if (!b.initialEta) return 1;
                
                // Both have ETA, sort by displayDate descending (most recent first)
                return b.displayDate.getTime() - a.displayDate.getTime();
              });
            })
          );
        })
      );
    });
  }
}
