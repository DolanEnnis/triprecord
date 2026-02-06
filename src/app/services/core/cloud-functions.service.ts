import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { from, Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class CloudFunctionsService {
  private functions = inject(Functions);

  /**
   * Triggers the 'gapFillCharges' cloud function.
   * This function manually syncs legacy charges to trips to fix data gaps.
   */
  runGapFill(): Observable<any> {
    const gapFill = httpsCallable(this.functions, 'gapFillCharges');
    return from(gapFill());
  }
}
