import { Component, inject } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatSortModule } from '@angular/material/sort';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RiverStateService } from '../services/river-state.service';
import { TimeAgoPipe } from '../shared/pipes/time-ago.pipe';
import { Visit } from '../models/data.model';
import { Timestamp } from '@angular/fire/firestore';

@Component({
  selector: 'app-status-list',
  standalone: true,
  imports: [
    CommonModule,
    MatTableModule,
    MatSortModule,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    DatePipe,
    TimeAgoPipe
  ],
  templateUrl: './status-list.component.html',
  styleUrl: './status-list.component.css'
})
export class StatusListComponent {
  private readonly riverState = inject(RiverStateService);

  readonly dueShips = this.riverState.dueShips;
  readonly awaitingBerthShips = this.riverState.awaitingBerthShips;
  readonly alongsideShips = this.riverState.alongsideShips;

  // Columns: Ship, Date (ETA/ETD), Port, Note, Pilot, Updated
  displayedColumns: string[] = ['ship', 'officeTime', 'port', 'note', 'pilot', 'updated'];

  // Helper to get Date object from Timestamp or Date
  getDate(val: Timestamp | Date | any): Date {
    if (val instanceof Timestamp) return val.toDate();
    if (val instanceof Date) return val;
    return new Date();
  }

  // Helper to check if date is today (for red color logic)
  isToday(date: Date): boolean {
    const today = new Date();
    return date.getDate() === today.getDate() &&
           date.getMonth() === today.getMonth() &&
           date.getFullYear() === today.getFullYear();
  }
}
