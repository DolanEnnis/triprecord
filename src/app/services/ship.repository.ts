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
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from '@angular/fire/firestore';
import { from, map, Observable, of } from 'rxjs';
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
      const shipNameLower = data.shipName.toLowerCase();

      // 1. Check for existing ship by name.
      const existingShipQuery = query(
        shipsCollection,
        where('shipName_lowercase', '==', shipNameLower),
        limit(1)
      );
      const existingShipSnapshot = await getDocs(existingShipQuery);

      if (!existingShipSnapshot.empty) {
        // 2. Found existing ship: Update its details (like marine traffic link) and return its ID
        const shipDoc = existingShipSnapshot.docs[0];
        const shipDocRef = doc(this.firestore, `ships/${shipDoc.id}`);

        // The user may have corrected or added details to an existing ship.
        // We update the master record with the data from the form.
        const updateData: Partial<Ship> = {
          grossTonnage: data.grossTonnage,
          imoNumber: data.imoNumber,
          shipName_lowercase: shipNameLower, // Ensure lowercase field is updated
          marineTrafficLink: data.marineTrafficLink,
          shipNotes: data.shipNotes,
          updatedAt: serverTimestamp(),
        };

        await updateDoc(shipDocRef, updateData);
        return shipDoc.id;
      } else {
        // 3. Not found: Create a brand new Ship document
        const newShip: Omit<Ship, 'id'> = {
          shipName: data.shipName,
          shipName_lowercase: shipNameLower,
          grossTonnage: data.grossTonnage,
          imoNumber: data.imoNumber,
          marineTrafficLink: data.marineTrafficLink,
          shipNotes: data.shipNotes,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };

        const shipDocRef = await addDoc(shipsCollection, newShip);
        return shipDocRef.id;
      }
    });
  }

  /**
   * Fetches a single Ship document by its Firestore ID.
   * @param shipId The ID of the ship to fetch.
   */
  getShipById(shipId: string): Observable<Ship | undefined> {
    return runInInjectionContext(this.injector, () => {
      const shipDocRef = doc(this.firestore, `ships/${shipId}`);
      return from(getDoc(shipDocRef)).pipe(
        map(docSnap => docSnap.exists() ? { id: docSnap.id, ...docSnap.data() } as Ship : undefined)
      );
    });
  }

  /**
   * Finds a single ship by its exact name (case-insensitive).
   * @param name The exact name of the ship to find.
   */
  findShipByName(name: string): Observable<Ship | undefined> {
    return runInInjectionContext(this.injector, () => {
      const shipsCollection = collection(this.firestore, 'ships');
      const lowerCaseName = name.toLowerCase();
      const q = query(shipsCollection, where('shipName_lowercase', '==', lowerCaseName), limit(1));

      return from(getDocs(q)).pipe(
        map(querySnapshot => {
          if (querySnapshot.empty) return undefined;
          const doc = querySnapshot.docs[0];
          return { id: doc.id, ...doc.data() } as Ship;
        })
      );
    });
  }

  /**
   * Gets ship name and GT suggestions from the master '/ships' collection.
   * This is more efficient and accurate than querying historical visits.
   * @param search The string to search for.
   */
  getShipSuggestions(search: string): Observable<{ ship: string; gt: number; id: string }[]> {
    if (!search || search.length < 2) {
      return of([]);
    }

    return runInInjectionContext(this.injector, () => {
      const shipsCollection = collection(this.firestore, 'ships');
      const lowerCaseSearch = search.toLowerCase();
      const q = query(
        shipsCollection,
        // 🛑 CRITICAL: Query against the normalized lowercase field.
        where('shipName_lowercase', '>=', lowerCaseSearch),
        where('shipName_lowercase', '<=', lowerCaseSearch + '\uf8ff'),
        orderBy('shipName_lowercase'), // Order by the same field for index efficiency
        limit(10)
      );

      return (collectionData(q, { idField: 'id' }) as Observable<Ship[]>).pipe( // 🚀 Added idField: 'id' to collectionData
        map((ships) => ships.map((ship) => ({
          ship: ship.shipName,
          gt: ship.grossTonnage,
          id: ship.id! // 🚀 Exposed the ship ID
        })))
      );
    });
  }

  /**
   * Searches for ships by name (prefix match, case-insensitive).
   * Used by port-reconciliation component.
   * @param search The search string.
   * @returns Observable array of matching Ship objects.
   */
  searchShipsByName(search: string): Observable<Ship[]> {
    if (!search || search.length < 2) {
      return of([]);
    }

    return runInInjectionContext(this.injector, () => {
      const shipsCollection = collection(this.firestore, 'ships');
      const lowerCaseSearch = search.toLowerCase();
      const q = query(
        shipsCollection,
        where('shipName_lowercase', '>=', lowerCaseSearch),
        where('shipName_lowercase', '<=', lowerCaseSearch + '\uf8ff'),
        orderBy('shipName_lowercase'),
        limit(20)
      );

      return collectionData(q, { idField: 'id' }) as Observable<Ship[]>;
    });
  }

  /**
   * Finds an existing Ship document by name and updates its grossTonnage if different,
   * or creates a new Ship document if it doesn't exist.
   * This is used by the charge creation/editing flow to keep the master ship list up-to-date
   * and returns the ID of the found or created document.
   * @param shipName The name of the ship.
   * @param grossTonnage The Gross Tonnage.
   * @returns The Firestore ID of the Ship document.
   */
  async ensureShipDetails(shipName: string, grossTonnage: number): Promise<string> {
    if (!shipName || !grossTonnage) {
      throw new Error('Ship name and GT are required to find or create a ship.');
    }

    return runInInjectionContext(this.injector, async () => {
      const shipsCollection = collection(this.firestore, 'ships');
      const shipNameLower = shipName.toLowerCase();

      // 1. Check for existing ship by name
      const existingShipQuery = query(
        shipsCollection,
        where('shipName_lowercase', '==', shipNameLower),
        limit(1)
      );
      const existingShipSnapshot = await getDocs(existingShipQuery);

      if (!existingShipSnapshot.empty) {
        // 2. Found existing ship: Check if GT needs update
        const shipDoc = existingShipSnapshot.docs[0];
        const shipDocRef = doc(this.firestore, `ships/${shipDoc.id}`);
        const shipData = shipDoc.data();

        // 🛑 FIX: Trigger an update if GT is different OR if the document is missing the lowercase field.
        // This performs a "lazy migration" to fix old data.
        if (shipData['grossTonnage'] !== grossTonnage || !shipData['shipName_lowercase']) {
          await updateDoc(shipDocRef, {
            grossTonnage: grossTonnage,
            shipName_lowercase: shipNameLower, // Keep lowercase field consistent
            updatedAt: serverTimestamp(),
          });
        }
        return shipDoc.id; // Return the existing ID
      } else {
        // 3. Not found: Create a brand new Ship document
        const newShip: Omit<Ship, 'id'> = {
          shipName: shipName,
          shipName_lowercase: shipNameLower,
          grossTonnage: grossTonnage,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          // Other optional fields remain undefined
        };
        const shipDocRef = await addDoc(shipsCollection, newShip);
        return shipDocRef.id; // Return the new ID
      }
    });
  }
  async updateShip(shipId: string, data: Partial<Ship>): Promise<void> {
    return runInInjectionContext(this.injector, async () => {
      const shipDocRef = doc(this.firestore, `ships/${shipId}`);
      await updateDoc(shipDocRef, {
        ...data,
        updatedAt: serverTimestamp()
      });
    });
  }
}
