import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, from, map } from 'rxjs';

export interface ShipIntelligenceData {
  shipName: string;
  grossTonnage: number;
  deadweightTonnage: number;
  yearBuilt: number;
  buildLocation: string;
  manager: string;
  formerNames: string[];
  last4Ports: string[];
  nextPort: string;
  eta: string;
  news: string | null;
}

@Injectable({
  providedIn: 'root'
})
export class ShipIntelligenceService {
  private functions = inject(Functions);
  private fetchShipDetailsCallable = httpsCallable<{ imo: string }, ShipIntelligenceData>(this.functions, 'fetchShipDetails');

  fetchShipDetails(imo: string): Observable<ShipIntelligenceData> {
    return from(this.fetchShipDetailsCallable({ imo })).pipe(
      map(result => result.data)
    );
  }
}
