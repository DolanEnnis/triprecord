import { Injectable } from '@angular/core';
import { UnifiedTrip } from '../models/trip.model';

export type TripWithWarnings = UnifiedTrip & { dataWarnings: string[] };

@Injectable({
  providedIn: 'root'
})
export class DataQualityService {
  private readonly SPELLING_MISTAKE_THRESHOLD = 2;
  private warningIdCounter = 1;

  constructor() { }

  /**
   * Processes a list of trips to find and flag potential data quality issues.
   * @param trips The array of trip objects.
   * @returns A new array of trip objects, with a `dataWarnings` array property added.
   */
  public applyDataQualityChecks(trips: UnifiedTrip[]): TripWithWarnings[] {
    if (!trips || trips.length === 0) {
      return [];
    }

    this.warningIdCounter = 1; // Reset counter for each run to ensure consistent IDs

    const processedTrips: TripWithWarnings[] = trips.map(trip => ({ ...trip, dataWarnings: [] as string[] }));

    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
    sixtyDaysAgo.setHours(0, 0, 0, 0);

    const recentTripsForPairChecks = processedTrips.filter(t => new Date(t.boarding) >= sixtyDaysAgo);

    // 1. Pair-wise checks (Duplicates, Spelling, GT mistakes)
    for (let i = 0; i < recentTripsForPairChecks.length; i++) {
      const tripA = recentTripsForPairChecks[i];
      for (let j = i + 1; j < recentTripsForPairChecks.length; j++) {
        const tripB = recentTripsForPairChecks[j];

        // Normalize ship names by trimming whitespace to prevent false flags.
        const shipAName = (tripA.ship || '').trim();
        const shipBName = (tripB.ship || '').trim();

        // Possible Duplicate
        const isSameDay = new Date(tripA.boarding).toDateString() === new Date(tripB.boarding).toDateString();
        if (shipAName && shipBName && shipAName === shipBName && isSameDay && tripA.typeTrip === tripB.typeTrip) {
          const warningId = `E${this.warningIdCounter++}`;
          tripA.dataWarnings.push(`(${warningId}) Possible Duplicate`);
          tripB.dataWarnings.push(`(${warningId}) Possible Duplicate`);
        }

        // Possible Spelling mistake
        // Convert to lowercase for case-insensitive comparison
        const shipANameLower = shipAName.toLowerCase();
        const shipBNameLower = shipBName.toLowerCase();
        
        const shipAWords = shipANameLower.split(' ');
        const shipBWords = shipBNameLower.split(' ');

        // Heuristic: If the first word is the same and there's more than one word,
        // assume it's a fleet naming convention (e.g., 'Arklow Wind', 'Arklow Wave'), not a spelling mistake.
        const isFleetNaming = shipAWords.length > 1 &&
          shipBWords.length > 1 &&
          shipAWords[0] === shipBWords[0];

        // Only flag as spelling mistake if names differ (case-insensitive) and have small edit distance
        if (!isFleetNaming && tripA.gt === tripB.gt && shipAName && shipBName && shipANameLower !== shipBNameLower && this.levenshteinDistance(shipANameLower, shipBNameLower) <= this.SPELLING_MISTAKE_THRESHOLD) {
          const warningId = `E${this.warningIdCounter++}`;
          tripA.dataWarnings.push(`(${warningId}) Possible Spelling mistake`);
          tripB.dataWarnings.push(`(${warningId}) Possible Spelling mistake`);
        }

        // Possible GT mistake
        if (shipAName && shipBName && shipAName === shipBName && tripA.gt !== tripB.gt) {
          const warningId = `E${this.warningIdCounter++}`;
          tripA.dataWarnings.push(`(${warningId}) Possible GT mistake`);
          tripB.dataWarnings.push(`(${warningId}) Possible GT mistake`);
        }
      }
    }

    // 2. Missing In/Out trip checks for the PREVIOUS CALENDAR MONTH
    // Calculate the start and end dates for the previous calendar month.
    const today = new Date();
    const firstDayOfCurrentMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const firstDayOfPreviousMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);

    const tripsByShip = new Map<string, TripWithWarnings[]>();
    processedTrips.forEach(trip => {
      // Normalize ship name when creating the map to ensure 'SHIP ' and 'SHIP' are grouped together.
      const shipName = (trip.ship || '').trim();
      if (shipName) {
        tripsByShip.set(shipName, [...(tripsByShip.get(shipName) || []), trip]);
      }
    });

    tripsByShip.forEach(allShipTrips => {
      // Sort all trips for this ship chronologically.
      allShipTrips.sort((a, b) => new Date(a.boarding).getTime() - new Date(b.boarding).getTime());

      // Iterate through this ship's trips to find ones in the previous month to check.
      allShipTrips.forEach((trip, index) => {
        const tripDate = new Date(trip.boarding);

        // Check if the current trip is within the previous calendar month.
        if (tripDate >= firstDayOfPreviousMonth && tripDate < firstDayOfCurrentMonth) {
          // "Possible missing outward trip"
          if (trip.typeTrip === 'In') {
            // Search for an 'Out' trip for the same ship on or after this 'In' trip's date.
            const hasLaterOutwardTrip = allShipTrips.slice(index + 1).some(futureTrip => futureTrip.typeTrip === 'Out');
            if (!hasLaterOutwardTrip) {
              const warningId = `E${this.warningIdCounter++}`;
              trip.dataWarnings.push(`(${warningId}) Possible missing outward trip`);
            }
          }

          // "Possible missing inward trip"
          if (trip.typeTrip === 'Out') {
            // Search for an 'In' trip on or before this 'Out' trip's date, but not older than 60 days ago from today.
            const hasPriorInwardTrip = allShipTrips.slice(0, index).some(priorTrip =>
              priorTrip.typeTrip === 'In' && new Date(priorTrip.boarding) >= sixtyDaysAgo
            );
            if (!hasPriorInwardTrip) {
              const warningId = `E${this.warningIdCounter++}`;
              trip.dataWarnings.push(`(${warningId}) Possible missing inward trip`);
            }
          }
        }
      });
    });

    // 3. Finalize: Remove duplicate warnings from each trip
    processedTrips.forEach(trip => {
      if (trip.dataWarnings.length > 0) {
        trip.dataWarnings = [...new Set(trip.dataWarnings)];
      }
    });

    return processedTrips;
  }

  /**
   * Calculates the Levenshtein distance between two strings.
   * Used to find potential spelling mistakes in ship names.
   */
  private levenshteinDistance(a: string = '', b: string = ''): number {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));

    for (let i = 0; i <= a.length; i += 1) {
      matrix[0][i] = i;
    }

    for (let j = 0; j <= b.length; j += 1) {
      matrix[j][0] = j;
    }

    for (let j = 1; j <= b.length; j += 1) {
      for (let i = 1; i <= a.length; i += 1) {
        const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1, // deletion
          matrix[j - 1][i] + 1, // insertion
          matrix[j - 1][i - 1] + indicator, // substitution
        );
      }
    }

    return matrix[b.length][a.length];
  }
}
