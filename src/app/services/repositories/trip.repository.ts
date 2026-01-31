import { inject, Injectable, Injector, runInInjectionContext } from '@angular/core';
import {
  addDoc,
  collection,
  collectionData,
  deleteDoc,
  doc,
  Firestore,
  getDocs,
  query,
  Timestamp,
  updateDoc,
  where,
  orderBy,
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { Trip } from '../../models';


/**
 * TripRepository handles all direct data access operations for the '/trips' Firestore collection.
 * It's responsible for creating, fetching, and updating trip records.
 */
@Injectable({
  providedIn: 'root',
})
export class TripRepository {
  private readonly firestore: Firestore = inject(Firestore);
  private readonly injector: Injector = inject(Injector);

  /**
   * Adds a new trip to the database.
   * 
   * ERROR HANDLING:
   * - Firestore errors are caught and re-thrown with context
   * - Caller is responsible for handling the error (e.g., showing user feedback)
   * - No console spam in production
   */
  async addTrip(trip: Omit<Trip, 'id'>): Promise<string> {
    try {
      const tripsCollection = collection(this.firestore, 'trips');
      const docRef = await addDoc(tripsCollection, trip);
      return docRef.id;
    } catch (error: any) {
      // Only log errors, not success cases
      console.error('Failed to add trip document:', error);
      throw new Error(`Database error during trip creation: ${error.message || 'Unknown error'}`);
    }
  }

  async updateTrip(tripId: string, data: Partial<Trip>): Promise<void> {
    const tripDocRef = doc(this.firestore, `trips/${tripId}`);
    await updateDoc(tripDocRef, data);
  }

  /**
   * Deletes a trip from the database.
   * Used when user removes an additional trip from a visit.
   * 
   * @param tripId - ID of the trip to delete
   */
  async deleteTrip(tripId: string): Promise<void> {
    const tripDocRef = doc(this.firestore, `trips/${tripId}`);
    await deleteDoc(tripDocRef);
  }

  /**
   * Fetches trips for a visit using getDocs (Promise-based).
   * PREFERRED for one-time loads (like dialogs) to avoid RxJS take(1) race conditions with cache.
   */
  async getTripsByVisitIdOnce(visitId: string): Promise<Trip[]> {
    const tripsCollection = collection(this.firestore, 'trips');
    const q = query(tripsCollection, where('visitId', '==', visitId));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Trip));
  }

  getRecentTrips(threeMonthsAgoTimestamp: Timestamp): Observable<Trip[]> {
    const tripsCollection = collection(this.firestore, 'trips');
    const recentTripsQuery = query(tripsCollection, where('boarding', '>=', threeMonthsAgoTimestamp), orderBy('boarding', 'desc'));
    return collectionData(recentTripsQuery, { idField: 'id' }) as Observable<Trip[]>;
  }

  getTripsByVisitId(visitId: string): Observable<Trip[]> {
    return runInInjectionContext(this.injector, () => {
      const tripsCollection = collection(this.firestore, 'trips');
      const q = query(tripsCollection, where('visitId', '==', visitId));
      return collectionData(q, { idField: 'id' }) as Observable<Trip[]>;
    });
  }

  /**
   * Migrates all trips from one ship to another.
   * Updates the denormalized shipId field on all trips.
   * 
   * LEARNING: WHY TRIPS HAVE DENORMALIZED shipId
   * Trips have a shipId field to enable direct queries like:
   * "Find all trips for ship X" without needing to join through visits.
   * This field must be kept in sync when ships are merged.
   * 
   * @param oldShipId The ship ID to migrate trips FROM
   * @param newShipId The ship ID to migrate trips TO
   * @returns Number of trips migrated
   */
  async migrateTripsToShip(
    oldShipId: string,
    newShipId: string
  ): Promise<number> {
    const { writeBatch } = await import('@angular/fire/firestore');
    
    // Find all trips belonging to the old ship
    const tripsCollection = collection(this.firestore, 'trips');
    const tripsQuery = query(
      tripsCollection,
      where('shipId', '==', oldShipId)
    );
    
    const snapshot = await getDocs(tripsQuery);
    
    if (snapshot.empty) {
      return 0;
    }
    
    // Use batched writes for atomicity
    const batch = writeBatch(this.firestore);
    
    snapshot.docs.forEach(docSnapshot => {
      const tripRef = doc(this.firestore, `trips/${docSnapshot.id}`);
      batch.update(tripRef, {
        shipId: newShipId
      });
    });
    
    await batch.commit();
    
    return snapshot.size;
  }
}
