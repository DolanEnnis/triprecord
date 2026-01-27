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
}
