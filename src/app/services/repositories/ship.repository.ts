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
   * Forces creation of a new Ship document, even if one with the same name exists.
   * 
   * LEARNING: WHEN TO USE THIS
   * - Different vessels can share the same name (e.g., "ATLANTIC TRADER")
   * - When user explicitly confirms they want a SEPARATE ship record
   * - The dialog warns the user before calling this method
   * 
   * @param data The form data containing ship details.
   * @returns The Firestore ID of the newly created Ship document.
   */
  async forceCreateShip(data: NewVisitData): Promise<string> {
    const shipsCollection = collection(this.firestore, 'ships');
    const shipNameLower = data.shipName.toLowerCase();

    // Always create a new Ship document, bypassing duplicate check
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
   * @returns The Firestore ID of the Ship document.
   */
  async ensureShipDetails(shipName: string, grossTonnage: number): Promise<string> {
    if (!shipName || !grossTonnage) {
      throw new Error('Ship name and GT are required to find or create a ship.');
    }

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
  }
  async updateShip(shipId: string, data: Partial<Ship>): Promise<void> {
    const shipDocRef = doc(this.firestore, `ships/${shipId}`);
    await updateDoc(shipDocRef, {
      ...data,
      updatedAt: serverTimestamp()
    });
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
    const { deleteDoc } = await import('@angular/fire/firestore');
    const shipDocRef = doc(this.firestore, `ships/${shipId}`);
    await deleteDoc(shipDocRef);
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
}

