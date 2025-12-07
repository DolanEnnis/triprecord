import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterModule } from '@angular/router';
import { PreviousVisitsListComponent } from './previous-visits-list/previous-visits-list.component';
import { VisitRepository } from '../services/visit.repository';
import { Observable, of } from 'rxjs';

@Component({
  selector: 'app-previous-visits',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatInputModule,
    MatFormFieldModule,
    MatButtonModule,
    MatIconModule,
    RouterModule,
    PreviousVisitsListComponent
  ],
  templateUrl: './previous-visits.component.html',
  styleUrls: ['./previous-visits.component.css']
})
export class PreviousVisitsComponent implements OnInit {
  visits$!: Observable<any[]>;
  
  dateRangeForm = new FormGroup({
    startDate: new FormControl<Date | null>(null),
    endDate: new FormControl<Date | null>(null)
  });

  constructor(private visitRepository: VisitRepository) {}

  ngOnInit() {
    // Load last 2 months by default
    this.loadDefaultRange();
  }

  loadDefaultRange() {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - 2);
    
    this.dateRangeForm.setValue({
      startDate: startDate,
      endDate: endDate
    });
    
    this.searchByDateRange();
  }

  searchByDateRange() {
    const startDate = this.dateRangeForm.value.startDate || undefined;
    const endDate = this.dateRangeForm.value.endDate || undefined;
    
    this.visits$ = this.visitRepository.getAllCompletedVisits(startDate, endDate);
  }

  clearDates() {
    this.loadDefaultRange();
  }
}
