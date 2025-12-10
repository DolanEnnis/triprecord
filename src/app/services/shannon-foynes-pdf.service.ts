import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, from } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ShannonFoynesShip {
  shipName: string;
  grossTonnage?: number;
  location?: string;
  cargo?: string;
  arrivalDate?: string;
  departureDate?: string;
  agent?: string;
}

export interface ShannonFoynesPDFResponse {
  success: boolean;
  ships: ShannonFoynesShip[];
  rawTextLength: number;
  extractedAt: string;
}

/**
 * Service to parse Shannon Foynes Port Company PDF reports
 * Extracts ship information using Cloud Functions
 */
@Injectable({
  providedIn: 'root'
})
export class ShannonFoynesPdfService {
  private functions = inject(Functions);

  /**
   * Parse the Shannon Foynes Port Company daily diary PDF
   * @param pdfUrl Optional custom PDF URL (defaults to current day diary)
   * @returns Observable of parsed ship data
   */
  parseDailyDiary(pdfUrl?: string): Observable<ShannonFoynesPDFResponse> {
    const callable = httpsCallable<{ pdfUrl?: string }, ShannonFoynesPDFResponse>(
      this.functions,
      'parseShannonFoynesPDF'
    );

    return from(callable({ pdfUrl })).pipe(
      map((result) => result.data)
    );
  }

  /**
   * Find a ship by name in the Shannon Foynes PDF
   * @param shipName The ship name to search for
   * @param pdfUrl Optional custom PDF URL
   * @returns Observable of the ship if found, null otherwise
   */
  findShipByName(shipName: string, pdfUrl?: string): Observable<ShannonFoynesShip | null> {
    return this.parseDailyDiary(pdfUrl).pipe(
      map((response) => {
        const ship = response.ships.find(
          (s) => s.shipName.toLowerCase().includes(shipName.toLowerCase())
        );
        return ship || null;
      })
    );
  }
}
