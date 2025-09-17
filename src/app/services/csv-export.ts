import { Injectable, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { TripWithWarnings } from './data-quality';
import * as Papa from 'papaparse';

@Injectable({
  providedIn: 'root'
})
export class CsvExportService {
  private readonly datePipe = inject(DatePipe);

  public exportConfirmedTrips(trips: TripWithWarnings[]): void {
    const dataForCsv = this.mapTripsToCsvData(trips);
    const csv = Papa.unparse(dataForCsv);
    const filename = `confirmed_trips_${this.datePipe.transform(new Date(), 'yyyy-MM-dd')}.csv`;
    this.downloadCsv(csv, filename);
  }

  private mapTripsToCsvData(trips: TripWithWarnings[]): object[] {
    return trips.map(trip => {
      let noteWithWarnings = trip.sailingNote || '';
      if (trip.dataWarnings && trip.dataWarnings.length > 0) {
        const warningsText = `[${trip.dataWarnings.join('; ')}] `;
        noteWithWarnings = `${warningsText}${noteWithWarnings}`.trim();
      }

      return {
        'Timestamp': this.datePipe.transform(trip.updateTime, 'dd-MM-yy HH:mm:ss'),
        'Ship': trip.ship,
        'GT': trip.gt,
        'Date': this.datePipe.transform(trip.boarding, 'dd/MM/yy'),
        'In / Out': trip.typeTrip,
        'To/From': trip.port,
        'Late Order / Detention /Anchoring etc': trip.extra,
        'Pilot': trip.pilot,
        'Note': noteWithWarnings,
      };
    });
  }

  private downloadCsv(csv: string, filename: string): void {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url); // Clean up the object URL
  }
}
