import { inject, Injectable, Injector, runInInjectionContext } from '@angular/core';
import {
  addDoc,
  collection,
  collectionData,
  doc,
  Firestore,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
} from '@angular/fire/firestore';
import {  map, Observable, of } from 'rxjs';
import { Ship, NewVisitData } from '../models/data.model';

/**
 * ShipRepository handles all direct data access operations for the '/ships' Firestore collection.
 * It's responsible for finding, creating, and updating ship records.
 */
@Injectable({
  providedIn: 'root',
})
export class ShipRepository {
  private readonly firestore: Firestore = inject(Firestore);
  private readonly injector = inject(Injector);

  /**
   * Finds an existing Ship document by name or creates a new one.
   * This ensures the master /ships collection is the source of truth for ship data.
   * @param data The form data containing ship details.
   * @returns The Firestore ID of the Ship document.
   */
  async findOrCreateShip(data: NewVisitData): Promise<string> {
    return runInInjectionContext(this.injector, async () => {
      const shipsCollection = collection(this.firestore, 'ships');
      const now = serverTimestamp();

      // 1. Check for existing ship by name (case-insensitive query is complex, we use exact for now)
      const existingShipQuery = query(
        shipsCollection,
        where('shipName', '==', data.shipName),
        limit(1)
      );
      const existingShipSnapshot = await getDocs(existingShipQuery);

      if (!existingShipSnapshot.empty) {
        // 2. Found existing ship: Update its details (like marine traffic link) and return its ID
        const shipDoc = existingShipSnapshot.docs[0];
        const shipDocRef = doc(this.firestore, `ships/${shipDoc.id}`);

        const updateData: Partial<Ship> = {
          grossTonnage: data.grossTonnage,
          imoNumber: data.imoNumber,
          marineTrafficLink: data.marineTrafficLink,
          shipNotes: data.shipNotes,
          updatedAt: now as Timestamp,
        };

        await updateDoc(shipDocRef, updateData);
        return shipDoc.id;
      } else {
        // 3. Not found: Create a brand new Ship document
        const newShip: Omit<Ship, 'id'> = {
          shipName: data.shipName,
          grossTonnage: data.grossTonnage,
          imoNumber: data.imoNumber,
          marineTrafficLink: data.marineTrafficLink,
          shipNotes: data.shipNotes,
          createdAt: now as Timestamp,
          updatedAt: now as Timestamp,
        };

        const shipDocRef = await addDoc(shipsCollection, newShip);
        return shipDocRef.id;
      }
    });
  }

  /**
   * Gets ship name and GT suggestions from the master '/ships' collection.
   * This is more efficient and accurate than querying historical visits.
   * @param search The string to search for.
   */
  getShipSuggestions(search: string): Observable<{ ship: string; gt: number }[]> {
    if (!search || search.length < 2) {
      return of([]);
    }

    const shipsCollection = collection(this.firestore, 'ships');
    // NOTE: This query requires an index on 'shipName'.
    const q = query(
      shipsCollection,
      where('shipName', '>=', search),
      where('shipName', '<=', search + '\uf8ff'),
      orderBy('shipName'),
      limit(10)
    );

    return (collectionData(q) as Observable<Ship[]>).pipe(
      map((ships) => ships.map((ship) => ({ ship: ship.shipName, gt: ship.grossTonnage })))
    );
  }
}
