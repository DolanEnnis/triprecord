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
import { Trip, Visit, VisitStatus, StatusListRow, EnrichedVisit, Port } from '../../models';
import type { Query, QueryConstraint, QueryDocumentSnapshot } from '@angular/fire/firestore';


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

  /**
   * Updates the berth port for a visit.
   * TYPE SAFETY: Now uses proper Port type instead of any
   */
  async updateVisitLocation(
    visitId: string,
    newPort: Port,
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
                switchMap((snapshot) => {
                  let tripData: (Trip & { id: string }) | undefined;
                  if (!snapshot.empty) {
                    const doc = snapshot.docs[0];
                    tripData = { ...doc.data() as Trip, id: doc.id };
                  }

                  // Fetch ship data to get marineTrafficLink
                  // We need to wrap Firebase calls in runInInjectionContext because switchMap 
                  // creates a new execution context where Angular's DI is not available
                  return runInInjectionContext(this.injector, () => {
                    const shipDocRef = doc(this.firestore, `ships/${visit.shipId}`);
                    return from(getDoc(shipDocRef)).pipe(
                      map((shipDoc) => {
                        const shipData = shipDoc.exists() ? shipDoc.data() as any : null;

                      // 3. Map to the clean View Model (StatusListRow)

                      // Safe Date Conversions - Status-specific logic:
                      // - 'Due' vessels should show ETA (when ship arrives at port)
                      // - 'Awaiting Berth' vessels should show ETB (pilot boarding time)
                      // - 'Alongside' vessels should show ETS (sailing time, from outward trip)
                      let activeDate: Date;
                      let isTimeSet = false; // Track if the time is actually set or a fallback
                      
                      if (status === 'Due') {
                        // For 'Due' status, always use the visit's initialEta
                        if (visit.initialEta && visit.initialEta instanceof Timestamp) {
                          activeDate = visit.initialEta.toDate();
                          isTimeSet = true; // ETA is the primary field for Due vessels
                        } else {
                          activeDate = new Date(); // Fallback if ETA is missing
                          isTimeSet = false;
                        }
                      } else {
                        // For 'Awaiting Berth' and 'Alongside', use the trip's boarding time
                        if (tripData?.boarding && tripData.boarding instanceof Timestamp) {
                          activeDate = tripData.boarding.toDate();
                          isTimeSet = true; // Boarding time (ETB/ETS) is explicitly set
                        } else if (visit.initialEta && visit.initialEta instanceof Timestamp) {
                          activeDate = visit.initialEta.toDate();
                          isTimeSet = false; // Fallback to ETA if boarding time not set
                        } else {
                          activeDate = new Date(); // Fallback if data is corrupt
                          isTimeSet = false;
                        }
                      }  

                      const updateDate =
                        visit.statusLastUpdated instanceof Timestamp
                          ? visit.statusLastUpdated.toDate()
                          : new Date();

                      return {
                        visitId: visit.id!,
                        tripId: tripData?.id, // Populate tripId
                        shipName: visit.shipName,
                        grossTonnage: visit.grossTonnage || 0,
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
                        marineTrafficLink: shipData?.marineTrafficLink || null, // Get link from ship data
                      } as StatusListRow;
                    })
                  );
                  }); // Close runInInjectionContext
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
      const visitUpdatePayload: Partial<Visit> = {
        statusLastUpdated: serverTimestamp(),
        updatedBy: updatedBy,
      };

      // 2. If 'Due', update initialEta on the Visit
      if (status === 'Due') {
        visitUpdatePayload.initialEta = Timestamp.fromDate(newDate);
        await updateDoc(visitDocRef, visitUpdatePayload);
      } else {
        // 3. For 'Awaiting Berth' or 'Alongside', update the correct Trip's boarding time
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
          // Trip exists - update it
          const tripDocRef = doc(this.firestore, `${this.TRIPS_COLLECTION}/${tripSnapshot.docs[0].id}`);
          await updateDoc(tripDocRef, {
            boarding: Timestamp.fromDate(newDate),
          });
        } else {
          // Trip doesn't exist - create it (defensive programming for legacy/incomplete data)
          console.warn(`Auto-creating missing ${targetTripType} trip for visit ${visitId}`);

          // Fetch visit data to get ship info
          const visitSnapshot = await getDoc(visitDocRef);
          if (!visitSnapshot.exists()) {
            console.error('Visit not found - cannot create trip:', visitId);
            throw new Error('Visit not found - cannot create trip');
          }

          const visitData = visitSnapshot.data() as Visit;

          // Create the missing trip with sensible defaults
          const newTrip: Omit<Trip, 'id'> = {
            visitId: visitId,
            shipId: visitData.shipId,
            typeTrip: targetTripType,
            boarding: Timestamp.fromDate(newDate),
            pilot: targetTripType === 'In' ? (visitData.inwardPilot || '') : '',
            port: visitData.berthPort || null,
            pilotNotes: '',
            extraChargesNotes: '',
            isConfirmed: false,
            recordedBy: updatedBy,
            recordedAt: serverTimestamp(),
            ownNote: null,
            pilotNo: null,
            monthNo: null,
            car: null,
            timeOff: null,
            good: null,
          };

          await addDoc(collection(this.firestore, this.TRIPS_COLLECTION), newTrip);
        }

        // Update visit AFTER trip is created/updated to avoid race condition
        await updateDoc(visitDocRef, visitUpdatePayload);
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
      const constraints: QueryConstraint[] = [];
      
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

  /**
   * Get enriched visits for a specific ship by shipId.
   * This includes full trip data (inward and outward trips) for complete visit history.
   * Used by the Ships page to show full visit details including berthed/sailed dates and pilots.
   */
  getEnrichedVisitsByShipId(shipId: string): Observable<EnrichedVisit[]> {
    return runInInjectionContext(this.injector, () => {
      const visitsCollection = collection(
        this.firestore,
        this.VISITS_COLLECTION
      );

      // Query for all visits for this ship, ordered by most recent first
      const visitsQuery = query(
        visitsCollection,
        where('shipId', '==', shipId),
        orderBy('initialEta', 'desc'),
        limit(100) // Limit to prevent excessive queries
      );

      return this.executeVisitsQuery(visitsQuery);
    });
  }

  /**
   * PROMISE-BASED VERSION: Get enriched visits for a specific ship.
   * 
   * LEARNING: WHY USE PROMISES INSTEAD OF OBSERVABLES FOR ONE-SHOT READS?
   * - collectionData() returns a live Observable that may emit empty first (cache miss)
   * - take(1) on that Observable can complete with empty before real data arrives
   * - getDocs() is Promise-based and WAITS for the actual Firestore response
   * - This eliminates race conditions when you only need one snapshot
   * 
   * Use this method for components that need a single read (dialogs, forms).
   * Use the Observable version for components that need live updates.
   */
  async getEnrichedVisitsByShipIdOnce(shipId: string): Promise<EnrichedVisit[]> {
    const visitsCollection = collection(this.firestore, this.VISITS_COLLECTION);
    
    // Query for all visits for this ship, ordered by most recent first
    const visitsQuery = query(
      visitsCollection,
      where('shipId', '==', shipId),
      orderBy('initialEta', 'desc'),
      limit(100)
    );

    try {
      const visitsSnapshot = await getDocs(visitsQuery);
      const visits = visitsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Visit));
      
      if (visits.length === 0) {
        return [];
      }

      // For each visit, fetch both In and Out trips
      const enrichedVisits: EnrichedVisit[] = await Promise.all(
        visits.map(async (visit) => {
          const tripsCollection = collection(this.firestore, this.TRIPS_COLLECTION);
          const tripQuery = query(tripsCollection, where('visitId', '==', visit.id));
          
          try {
            const tripSnapshot = await getDocs(tripQuery);
            let inTrip: Trip | undefined;
            let outTrip: Trip | undefined;

            tripSnapshot.docs.forEach((doc) => {
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

            const updateDate = visit.statusLastUpdated instanceof Timestamp
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
          } catch (error) {
            console.error(`Error fetching trips for visit ${visit.id}:`, error);
            // Return a minimal enriched visit on error
            return {
              visitId: visit.id!,
              shipId: visit.shipId,
              shipName: visit.shipName,
              grossTonnage: visit.grossTonnage,
              status: visit.currentStatus,
              initialEta: visit.initialEta instanceof Timestamp ? visit.initialEta.toDate() : null,
              displayDate: new Date(),
              arrivedDate: null,
              inwardPilot: 'Unassigned',
              inwardPort: 'No Info',
              sailedDate: null,
              outwardPilot: 'Unassigned',
              outwardPort: 'No Info',
              note: '',
              updatedBy: visit.updatedBy,
              updatedAt: new Date(),
              source: visit.source,
            };
          }
        })
      );

      // Filter out cancelled visits and sort
      const filteredVisits = enrichedVisits.filter(v => v.status !== 'Cancelled');
      return filteredVisits.sort((a, b) => {
        if (!a.initialEta && !b.initialEta) return 0;
        if (!a.initialEta) return -1;
        if (!b.initialEta) return 1;
        return b.displayDate.getTime() - a.displayDate.getTime();
      });
    } catch (error) {
      console.error('Error fetching enriched visits:', error);
      return [];
    }
  }

  /**
   * Executes a Firestore query and enriches visits with trip data.
   * TYPE SAFETY: Uses unknown instead of any (requires runtime type assertion)
   */
  private executeVisitsQuery(visitsQuery: unknown): Observable<EnrichedVisit[]> {
    return runInInjectionContext(this.injector, () => {
      return (
        collectionData(visitsQuery as any, { idField: 'id' }) as Observable<Visit[]>
      ).pipe(
        catchError((error) => {
          console.error('Error fetching visits:', error);
          return of([]);
        }),
        switchMap((visits) => {
          if (visits.length === 0) {
            return of([]);
          }

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
                  return of({ docs: [] });
                }),
                map((snapshot) => {
                  let inTrip: Trip | undefined;
                  let outTrip: Trip | undefined;

                  snapshot.docs.forEach((doc: QueryDocumentSnapshot<unknown>) => {
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

  /**
   * Migrates all visits from one ship to another.
   * Updates shipId and denormalized shipName/grossTonnage fields.
   * 
   * LEARNING: BATCHED WRITES FOR ATOMIC OPERATIONS
   * Firestore batched writes ensure all-or-nothing updates when modifying
   * multiple documents. This prevents partial updates if something fails
   * mid-operation.
   * 
   * @param oldShipId The ship ID to migrate visits FROM
   * @param newShipId The ship ID to migrate visits TO
   * @param newShipName The target ship's name (for denormalized field)
   * @param newGrossTonnage The target ship's GT (for denormalized field)
   * @returns Number of visits migrated
   */
  async migrateVisitsToShip(
    oldShipId: string,
    newShipId: string,
    newShipName: string,
    newGrossTonnage: number
  ): Promise<number> {
    const { writeBatch } = await import('@angular/fire/firestore');
    
    // Find all visits belonging to the old ship
    const visitsCollection = collection(this.firestore, this.VISITS_COLLECTION);
    const visitsQuery = query(
      visitsCollection,
      where('shipId', '==', oldShipId)
    );
    
    const snapshot = await getDocs(visitsQuery);
    
    if (snapshot.empty) {
      return 0;
    }
    
    // Use batched writes - Firestore allows up to 500 operations per batch
    const batch = writeBatch(this.firestore);
    
    snapshot.docs.forEach(docSnapshot => {
      const visitRef = doc(this.firestore, `${this.VISITS_COLLECTION}/${docSnapshot.id}`);
      batch.update(visitRef, {
        shipId: newShipId,
        shipName: newShipName,
        grossTonnage: newGrossTonnage,
        // Keep the lowercase field in sync for queries
        shipName_lowercase: newShipName.toLowerCase(),
        statusLastUpdated: serverTimestamp()
      });
    });
    
    await batch.commit();
    
    return snapshot.size;
  }
}
