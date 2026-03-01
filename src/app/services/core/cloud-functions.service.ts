import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { from, Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class CloudFunctionsService {
  private functions = inject(Functions);

  private gapFillCallable = httpsCallable(this.functions, 'gapFillCharges');
  private importTidesCallable = httpsCallable(this.functions, 'importTides');

  /**
   * Triggers the 'gapFillCharges' cloud function.
   * This function manually syncs legacy charges to trips to fix data gaps.
   */
  runGapFill(): Observable<any> {
    return from(this.gapFillCallable());
  }

  /**
   * Triggers the 'importTides' cloud function.
   * Uploads a raw CSV string of tide data to be parsed and saved to Firestore.
   */
  importTides(csvString: string): Observable<any> {
    return from(this.importTidesCallable({ csvString }));
  }
}
