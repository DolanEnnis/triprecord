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
import { Trip, AuditLog } from '../../models';


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

  /**
   * Fetches trips that have no boarding date set (meaning they are pending/active).
   * Note: This query assumes 'boarding' field exists but is null. 
   * Firestore queries for '== null' work for literal null values.
   */
  getPendingTrips(): Observable<Trip[]> {
    const tripsCollection = collection(this.firestore, 'trips');
    // We want active trips that haven't happened yet (boarding is null).
    // We also likely want to limit this to ensure we don't get ancient zombie records,
    // but for now, getting all null-boarding trips is the safe bet for "Active work".
    const pendingQuery = query(tripsCollection, where('boarding', '==', null));
    return collectionData(pendingQuery, { idField: 'id' }) as Observable<Trip[]>;
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

  /**
   * Updates ship details (shipName, gt) for all UNCONFIRMED trips associated with a ship.
   * 
   * CRITICAL DATA INTEGRITY LOGIC:
   * 1. Fetches ALL trips for the ship (both confirmed and unconfirmed).
   * 2. UPDATES 'isConfirmed: false' trips to match the new master ship details (Sync).
   * 3. SKIPS 'isConfirmed: true' trips to preserve historical billing accuracy (Snapshot).
   * 
   * @returns Object with counts for user feedback:
   *  - updatedCount: Number of unconfirmed trips updated.
   *  - skippedConfirmedCount: Number of confirmed trips that retained old data.
   */
  async updateShipDetailsForAllTrips(
    shipId: string,
    newShipName: string,
    newGt: number
  ): Promise<{ updatedCount: number; skippedConfirmedCount: number }> {
    const { writeBatch } = await import('@angular/fire/firestore');
    
    const tripsCollection = collection(this.firestore, 'trips');
    const tripsQuery = query(
      tripsCollection,
      where('shipId', '==', shipId)
    );
    
    const snapshot = await getDocs(tripsQuery);
    
    if (snapshot.empty) {
      return { updatedCount: 0, skippedConfirmedCount: 0 };
    }
    
    const batch = writeBatch(this.firestore);
    let updatedCount = 0;
    let skippedConfirmedCount = 0;
    
    snapshot.docs.forEach(docSnapshot => {
      const trip = docSnapshot.data() as Trip;
      
      // Check if data is actually different to avoid unnecessary writes/counts
      // Normalize comparison to avoid mismatch types (string vs number logic handled by type)
      const isNameDifferent = trip.shipName !== newShipName;
      const isGtDifferent = trip.gt !== newGt;
      
      if (isNameDifferent || isGtDifferent) {
        if (trip.isConfirmed) {
          // HISTORICAL PROTECTION: Confirmed trips are snapshots and SHOULD NOT change.
          skippedConfirmedCount++;
        } else {
          // ACTIVE SYNC: Unconfirmed trips should reflect the master record.
          const tripRef = doc(this.firestore, `trips/${docSnapshot.id}`);
          batch.update(tripRef, {
            shipName: newShipName,
            gt: newGt
          });
          updatedCount++;
        }
      }
    });
    
    if (updatedCount > 0) {
      await batch.commit();
    }
    
    return { updatedCount, skippedConfirmedCount };
  }

  /**
   * Checks whether a confirmed trip already exists for the given ship, trip type,
   * and boarding date (within the same calendar day).
   *
   * LEARNING: WHY WE MOVED THIS FROM /charges TO /trips
   * The old `doesChargeExist()` queried the `/charges` collection, but since all
   * new confirmations are now written to `/trips`, that query was always returning
   * `false` for new records — effectively breaking duplicate detection.
   *
   * We query `/trips` with:
   *  - isConfirmed == true  → only look at confirmed (billing) records
   *  - shipName == ship     → matches the denormalized billing field (not the visit-level `ship` field)
   *  - typeTrip == typeTrip → same movement type (In/Out/Shift etc.)
   *  - boarding within the same calendar day → 00:00:00 → 23:59:59
   *
   * @returns true if a matching confirmed trip already exists
   */
  async doesConfirmedTripExist(chargeData: { ship: string; boarding: Date; typeTrip: string }): Promise<boolean> {
    const tripsCollection = collection(this.firestore, 'trips');

    const startOfDay = new Date(chargeData.boarding);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(chargeData.boarding);
    endOfDay.setHours(23, 59, 59, 999);

    // Firestore compound query: confirmed trip for the same ship/type on the same day.
    const q = query(
      tripsCollection,
      where('isConfirmed', '==', true),
      where('shipName', '==', chargeData.ship),
      where('typeTrip', '==', chargeData.typeTrip),
      where('boarding', '>=', Timestamp.fromDate(startOfDay)),
      where('boarding', '<=', Timestamp.fromDate(endOfDay))
    );

    const querySnapshot = await getDocs(q);
    return !querySnapshot.empty;
  }

  /**
   * Retrieves the full change history for a single trip document.
   *
   * LEARNING: WHY A PROMISE (getDocs) INSTEAD OF AN OBSERVABLE (collectionData)?
   * Audit history is a one-shot read — we load it once when the dialog opens.
   * Using collectionData() would keep a live subscription open and re-emit
   * on every new log entry, causing unnecessary re-renders and extra reads.
   *
   * @param tripId The Firestore document ID of the trip
   * @returns Array of AuditLog entries ordered newest → oldest
   */
  async getAuditHistory(tripId: string): Promise<AuditLog[]> {
    const logsRef = collection(this.firestore, `trips/${tripId}/audit_logs`);
    const q = query(logsRef, orderBy('timestamp', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() } as AuditLog));
  }

}
