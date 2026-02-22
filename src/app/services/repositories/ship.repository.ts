import { inject, Injectable, Injector, runInInjectionContext } from '@angular/core';
import { TripRepository } from './trip.repository';
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
  deleteDoc,
} from '@angular/fire/firestore';
import { from, map, Observable, of } from 'rxjs';
import { Ship, NewVisitData } from '../../models';


/**
 * ShipRepository handles all direct data access operations for the '/ships' Firestore collection.
 * It's responsible for finding, creating, and updating ship records.
 */
@Injectable({
  providedIn: 'root',
})
export class ShipRepository {
  private readonly firestore: Firestore = inject(Firestore);
  private readonly injector: Injector = inject(Injector);
  private readonly tripRepository: TripRepository = inject(TripRepository);

  /**
   * Finds an existing Ship document by name or creates a new one.
   * This ensures the master /ships collection is the source of truth for ship data.
   * @param data The form data containing ship details.
   * @returns The Firestore ID of the Ship document.
   */
  async findOrCreateShip(data: NewVisitData): Promise<string> {
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

      // TRIGGER SYNC: Update all unconfirmed trips to match the new ship details
      // We don't wait for this/return stats here as findOrCreateShip is used in workflows 
      // where we prioritize flow speed and haven't built the UI for skipped-conflicts yet.
      // But we DO want the data validity.
      await this.tripRepository.updateShipDetailsForAllTrips(shipDoc.id, data.shipName, data.grossTonnage);

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
  }

  /**
   * Updates an existing Ship document and syncs changes to unconfirmed trips.
   * @param shipId The ID of the ship to update.
   * @param data The new ship data.
   * @returns Stats about how many trips were updated/skipped.
   */
  async updateShip(shipId: string, data: Partial<Ship>): Promise<{ updatedCount: number; skippedConfirmedCount: number }> {
    const shipDocRef = doc(this.firestore, `ships/${shipId}`);
    
    // 1. Update the master Ship record
    const updates: any = { ...data };
    
    // Maintain the lowercase helper field if name changes
    if (data.shipName) {
      updates.shipName_lowercase = data.shipName.toLowerCase();
      updates.updatedAt = serverTimestamp();
    } else {
      updates.updatedAt = serverTimestamp();
    }
    
    await updateDoc(shipDocRef, updates);

    // 2. Trigger Data Consistency Sync if Name or GT changed
    // (We need to ensure we run consistency check if either name or GT is modified)
    if (data.shipName || data.grossTonnage !== undefined) {
      // Fetch the Full Ship document to get final state (in case we only updated one field)
      const updatedShipSnap = await getDoc(shipDocRef);
      if (updatedShipSnap.exists()) {
        const updatedShip = updatedShipSnap.data() as Ship;
        return this.tripRepository.updateShipDetailsForAllTrips(
          shipId,
          updatedShip.shipName,
          updatedShip.grossTonnage
        );
      }
    }
    
    return { updatedCount: 0, skippedConfirmedCount: 0 };
  }

  /**
   * Forces the creation of a new Ship document, even if one with the same name exists.
   * This is used when the user explicitly requests a separate record for a vessel with a common name.
   * @param data The form data containing ship details.
   * @returns The Firestore ID of the new Ship document.
   */
  async forceCreateShip(data: NewVisitData): Promise<string> {
    const shipsCollection = collection(this.firestore, 'ships');
    const shipNameLower = data.shipName.toLowerCase();

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
  }

  /**
   * Gets ALL ships from the master '/ships' collection.
   * Used for client-side cached searching to enable "contains" matching.
   * Results are cached in the calling component to minimize Firebase reads.
   * @returns Observable array of all ships with name, GT, and ID
   */
  getAllShips(): Observable<{ ship: string; gt: number; id: string }[]> {
    return runInInjectionContext(this.injector, () => {
      const shipsCollection = collection(this.firestore, 'ships');
      
      // Fetch ALL ships, ordered by name
      const shipsQuery = query(
        shipsCollection,
        orderBy('shipName', 'asc')
      );

      return (collectionData(shipsQuery, { idField: 'id' }) as Observable<Ship[]>).pipe(
        map((ships: Ship[]) =>
          ships.map((ship: Ship) => ({
            ship: ship.shipName,
            gt: ship.grossTonnage,
            id: ship.id!
          }))
        )
      );
    });
  }

  /**
   * Searches for ships by name (prefix match, case-insensitive).
   * Used by sheet-info component.
   * @param search The search string.
   * @returns Observable array of matching Ship objects.
   */
  searchShipsByName(search: string): Observable<Ship[]> {
    if (!search || search.length < 2) {
      return of([]);
    }

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
  }

  /**
   * Finds an existing Ship document by name and updates its grossTonnage if different,
   * or creates a new Ship document if it doesn't exist.
   * This is used by the charge creation/editing flow to keep the master ship list up-to-date
   * and returns the ID of the found or created document.
   * @param shipName The name of the ship.
   * @param grossTonnage The Gross Tonnage.
   * @returns The Firestore ID of the Ship document and sync stats.
   */
  async ensureShipDetails(shipName: string, grossTonnage: number): Promise<{ id: string; syncResult: { updatedCount: number; skippedConfirmedCount: number } }> {
    if (!shipName || !grossTonnage) {
      throw new Error('Ship name and GT are required to find or create a ship.');
    }

    // WHY runInInjectionContext?
    // This method is called from dialog afterClosed() callbacks, which execute AFTER Angular's
    // injection context has been torn down. AngularFire's getDocs/addDoc/updateDoc wrappers
    // internally call inject() to resolve the Firebase app — that fails outside the DI context.
    // Wrapping in runInInjectionContext restores the injector so AngularFire can resolve.
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
        let stats = { updatedCount: 0, skippedConfirmedCount: 0 };
        
        if (shipData['grossTonnage'] !== grossTonnage || !shipData['shipName_lowercase']) {
          await updateDoc(shipDocRef, {
            grossTonnage: grossTonnage,
            shipName_lowercase: shipNameLower, // Keep lowercase field consistent
            updatedAt: serverTimestamp(),
          });
          
          // TRIGGER SYNC & RETURN STATS
          stats = await this.tripRepository.updateShipDetailsForAllTrips(shipDoc.id, shipName, grossTonnage);
        }
        return { id: shipDoc.id, syncResult: stats }; // Return ID and Stats
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
        
        // New ship, so no existing trips to update.
        return { id: shipDocRef.id, syncResult: { updatedCount: 0, skippedConfirmedCount: 0 } };
      }
    });
  }


  /**
   * Finds all ships with duplicate names (case-insensitive).
   * Returns a Map grouped by lowercase name, containing only groups with 2+ ships.
   * 
   * LEARNING: WHY FIND SAME-NAME DUPLICATES?
   * Ships without IMO numbers can only be detected as duplicates by their name.
   * This helps catch duplicate entries created before IMO validation was added.
   * 
   * @param excludeShipIds Optional set of ship IDs to exclude (e.g., already shown in IMO duplicates)
   */
  async findDuplicateShipsByName(excludeShipIds?: Set<string>): Promise<Map<string, Ship[]>> {
    const shipsCollection = collection(this.firestore, 'ships');
    
    // Fetch ALL ships - we need to group by name client-side
    const shipsQuery = query(
      shipsCollection,
      orderBy('shipName_lowercase', 'asc')
    );
    
    const snapshot = await getDocs(shipsQuery);
    const ships = snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() } as Ship))
      // Exclude ships that are already in IMO duplicate groups
      .filter(ship => !excludeShipIds || !excludeShipIds.has(ship.id!));
    
    // Group ships by lowercase name
    const nameGroups = new Map<string, Ship[]>();
    
    for (const ship of ships) {
      const lowercaseName = (ship.shipName_lowercase || ship.shipName.toLowerCase());
      const existingGroup = nameGroups.get(lowercaseName);
      if (existingGroup) {
        existingGroup.push(ship);
      } else {
        nameGroups.set(lowercaseName, [ship]);
      }
    }
    
    // Filter to only return groups with 2+ ships (actual duplicates)
    const duplicatesOnly = new Map<string, Ship[]>();
    for (const [name, shipGroup] of nameGroups) {
      if (shipGroup.length >= 2) {
        duplicatesOnly.set(name, shipGroup);
      }
    }
    
    return duplicatesOnly;
  }

  /**
   * Finds all ships with duplicate IMO numbers.
   * Returns a Map grouped by IMO number, containing only groups with 2+ ships.
   * 
   * LEARNING: WHY CLIENT-SIDE GROUPING?
   * Firestore doesn't support GROUP BY queries, so we fetch all ships 
   * with IMO numbers and group them in memory. This is acceptable because:
   * - Ships with IMO numbers are a finite set (a few hundred at most)
   * - This is an admin-only operation, not a user-facing query
   * - The grouping logic is simpler to understand and maintain in code
   */
  async findDuplicateShipsByImo(): Promise<Map<number, Ship[]>> {
    const shipsCollection = collection(this.firestore, 'ships');
    
    // Query all ships that have an IMO number (not null/undefined)
    // Firestore doesn't have "is not null", so we query for imoNumber >= 1000000 (minimum 7-digit IMO)
    const shipsWithImoQuery = query(
      shipsCollection,
      where('imoNumber', '>=', 1000000),
      orderBy('imoNumber', 'asc')
    );
    
    const snapshot = await getDocs(shipsWithImoQuery);
    const ships = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Ship));
    
    // Group ships by IMO number using a Map
    const imoGroups = new Map<number, Ship[]>();
    
    for (const ship of ships) {
      if (ship.imoNumber) {
        const existingGroup = imoGroups.get(ship.imoNumber);
        if (existingGroup) {
          existingGroup.push(ship);
        } else {
          imoGroups.set(ship.imoNumber, [ship]);
        }
      }
    }
    
    // Filter to only return groups with 2+ ships (actual duplicates)
    const duplicatesOnly = new Map<number, Ship[]>();
    for (const [imo, shipGroup] of imoGroups) {
      if (shipGroup.length >= 2) {
        duplicatesOnly.set(imo, shipGroup);
      }
    }
    
    return duplicatesOnly;
  }

  /**
   * Deletes a ship document from Firestore.
   * 
   * CAUTION: Only call this after visits/trips have been migrated to another ship!
   * This is an irreversible operation.
   * 
   * @param shipId The Firestore document ID of the ship to delete
   */
  async deleteShip(shipId: string): Promise<void> {
    const shipDocRef = doc(this.firestore, `ships/${shipId}`);
    await deleteDoc(shipDocRef);
  }

}
