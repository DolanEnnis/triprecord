import { Component, effect, inject } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import * as Papa from 'papaparse';

import { ChargesService } from '../services/charges.service';
import { Charge } from './charges.types';

@Component({
  selector: 'app-charges',
  standalone: true,
  imports: [
    CommonModule,
    DatePipe,
    MatFormFieldModule,
    MatInputModule,
    MatTableModule,
    MatProgressSpinnerModule,
    MatButtonModule,
    MatIconModule,
  ],
  templateUrl: './charges.component.html',
  styleUrls: ['./charges.component.css'],
  providers: [DatePipe], // Add DatePipe to make it injectable
})
export class ChargesComponent {
  private chargesService = inject(ChargesService);
  private datePipe = inject(DatePipe);

  // Fetch the raw data from the service as a signal.
  readonly charges = toSignal(this.chargesService.getRecentCharges());

  // Use MatTableDataSource for advanced features like sorting and filtering.
  readonly dataSource = new MatTableDataSource<Charge>();

  // Define the columns to display in the table. This order determines the column order.
  readonly displayedColumns: string[] = [
    'ship',
    'gt',
    'boarding',
    'typeTrip',
    'port',
    'extra',
    'note',
    'pilot',
    'updateTime',
  ];

  constructor() {
    // Use an effect to automatically update the dataSource whenever the `charges` signal changes.
    // This connects our data fetching to the table's data source.
    effect(() => {
      const data = this.charges();
      if (data) {
        this.dataSource.data = data;
      }
    });

    // Provide custom logic for how to filter the table.
    this.dataSource.filterPredicate = (data: Charge, filter: string): boolean => {
      // Create a single, searchable string from the row's data.
      const dataStr = [
        data.ship,
        data.gt,
        this.datePipe.transform(data.boarding.toDate(), 'dd-MM-yy'),
        data.typeTrip,
        data.port,
        data.extra,
        data.note,
        data.pilot,
        this.datePipe.transform(data.updateTime, 'dd-MM-yy'),
      ]
        .filter(Boolean) // Remove any null/undefined values
        .join(' ')
        .toLowerCase();

      // Check if the searchable string includes the user's filter term.
      return dataStr.includes(filter);
    };
  }

  applyFilter(event: Event): void {
    const filterValue = (event.target as HTMLInputElement).value;
    this.dataSource.filter = filterValue.trim().toLowerCase();
  }

  downloadCsv(): void {
    // Export the currently displayed (and potentially filtered and sorted) data.
    const data = this.dataSource.filteredData;
    if (!data || data.length === 0) {
      return;
    }

    // Map the data to a new structure with the desired headers and formatted values.
    const dataForCsv = data.map((charge) => ({
      'Ship': charge.ship,
      'GT': charge.gt,
      'Date': this.datePipe.transform(charge.boarding.toDate(), 'dd/MM/yy'),
      'In / Out': charge.typeTrip,
      'To/From': charge.port,
      'Late Order / Detention /Anchoring etc': charge.extra,
      'Note': charge.note,
      'Pilot': charge.pilot,
      'Timestamp': this.datePipe.transform(charge.updateTime, 'dd/MM/yy HH:mm:ss'),
    }));

    // Papa.unparse will use the keys from our new objects as the CSV headers.
    const csv = Papa.unparse(dataForCsv);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', 'charges-last-60-days.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}
