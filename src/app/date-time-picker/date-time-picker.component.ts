import { Component, forwardRef, inject } from '@angular/core';

import {
  ControlValueAccessor,
  FormBuilder,
  FormGroup,
  NG_VALUE_ACCESSOR,
  ReactiveFormsModule,
  Validators
} from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

// --- Angular Material & Core Imports ---
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule, DateAdapter } from '@angular/material/core';
import { MatAutocompleteModule } from '@angular/material/autocomplete';

@Component({
  selector: 'app-date-time-picker',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatAutocompleteModule
],
  templateUrl: './date-time-picker.component.html',
  styleUrls: ['./date-time-picker.component.css'],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => DateTimePickerComponent),
      multi: true
    }
  ]
})
export class DateTimePickerComponent implements ControlValueAccessor {
  private readonly fb = inject(FormBuilder);
  private readonly adapter = inject(DateAdapter<any>);

  form: FormGroup;

  // Generate 10-minute increments for the autocomplete suggestions
  minutes: { value: number; label: string }[] = Array.from({ length: 6 }, (_, i) => ({
    value: i * 10,
    label: (i * 10).toString().padStart(2, '0')
  }));

  onChange: (value: Date | null) => void = () => {};
  onTouched: () => void = () => {};

  constructor() {
    this.adapter.setLocale('en-GB');

    const now = new Date();
    this.form = this.fb.group({
      date: [now, Validators.required],
      hour: [String(now.getHours()).padStart(2, '0'), [Validators.required, Validators.min(0), Validators.max(23)]],
      minute: ['00', [Validators.required, Validators.min(0), Validators.max(59)]]
    });

    this.form.valueChanges.pipe(
      takeUntilDestroyed(),
    ).subscribe(value => {
      if (this.form.valid) {
        const { date, hour, minute } = value;
        // Parse string values to numbers
        const hourNum = parseInt(hour, 10);
        const minuteNum = parseInt(minute, 10);
        
        if (!isNaN(hourNum) && !isNaN(minuteNum) && hourNum >= 0 && hourNum <= 23 && minuteNum >= 0 && minuteNum <= 59) {
          const combinedDateTime = new Date(date);
          combinedDateTime.setHours(hourNum);
          combinedDateTime.setMinutes(minuteNum);
          combinedDateTime.setSeconds(0);
          this.onChange(combinedDateTime);
        }
      } else {
        this.onChange(null);
      }
    });
  }

  writeValue(value: Date | null): void {
    if (value) {
      this.form.setValue({
        date: value,
        hour: String(value.getHours()).padStart(2, '0'),
        minute: String(value.getMinutes()).padStart(2, '0')
      }, { emitEvent: false });
    }
  }

  registerOnChange(fn: any): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: any): void {
    this.onTouched = fn;
  }

  setDisabledState?(isDisabled: boolean): void {
    isDisabled ? this.form.disable() : this.form.enable();
  }

  handleBlur(): void {
    // Pad hour and minute values when user leaves the field
    const hourControl = this.form.get('hour');
    const minuteControl = this.form.get('minute');
    
    if (hourControl?.value) {
      const hourNum = parseInt(hourControl.value, 10);
      if (!isNaN(hourNum) && hourNum >= 0 && hourNum <= 23) {
        hourControl.setValue(String(hourNum).padStart(2, '0'), { emitEvent: false });
      }
    }
    
    if (minuteControl?.value) {
      const minuteNum = parseInt(minuteControl.value, 10);
      if (!isNaN(minuteNum) && minuteNum >= 0 && minuteNum <= 59) {
        minuteControl.setValue(String(minuteNum).padStart(2, '0'), { emitEvent: false });
      }
    }
    
    this.onTouched();
  }
}
