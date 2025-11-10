import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

// --- Angular Material & Core Imports ---
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule, DateAdapter } from '@angular/material/core';

@Component({
  selector: 'app-date-time-picker',
  standalone: true,
  imports: [
    // Core
    CommonModule, ReactiveFormsModule,
    // Material
    MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule, MatDatepickerModule,
    MatNativeDateModule,
  ],
  templateUrl: './date-time-picker.component.html',
  styleUrls: ['./date-time-picker.component.css']
})
export class DateTimePickerComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly adapter = inject(DateAdapter<any>);

  form!: FormGroup;
  readonly minDate = new Date();

  constructor() {
    this.adapter.setLocale('en-GB');
  }

  ngOnInit(): void {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();

    this.form = this.fb.group({
      date: [now, Validators.required],
      hour: [currentHour, [Validators.required, Validators.min(0), Validators.max(23)]],
      minute: [currentMinute, [Validators.required, Validators.min(0), Validators.max(59)]]
    });
  }

  onSubmit(): void {
    if (this.form.valid) {
      const { date, hour, minute } = this.form.value;

      const hours = parseInt(hour, 10);
      const minutes = parseInt(minute, 10);

      const combinedDateTime = new Date(date);
      combinedDateTime.setHours(hours);
      combinedDateTime.setMinutes(minutes);
      combinedDateTime.setSeconds(0);

      console.log('Selected Date and Time:', combinedDateTime);
      // Here you can emit the value or handle it as needed
    }
  }
}
