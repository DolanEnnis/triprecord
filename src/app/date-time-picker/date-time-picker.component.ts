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
import { MatSelectModule } from '@angular/material/select';

@Component({
  selector: 'app-date-time-picker',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatSelectModule
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
  readonly minDate = new Date();

  minutes: { value: number; label: string }[] = Array.from({ length: 60 }, (_, i) => ({
    value: i,
    label: i.toString().padStart(2, '0')
  }));

  onChange: (value: Date | null) => void = () => {};
  onTouched: () => void = () => {};

  constructor() {
    this.adapter.setLocale('en-GB');

    const now = new Date();
    this.form = this.fb.group({
      date: [now, Validators.required],
      hour: [now.getHours(), [Validators.required, Validators.min(0), Validators.max(23)]],
      minute: [0, [Validators.required, Validators.min(0), Validators.max(59)]]
    });

    this.form.valueChanges.pipe(
      takeUntilDestroyed(),
    ).subscribe(value => {
      if (this.form.valid) {
        const { date, hour, minute } = value;
        const combinedDateTime = new Date(date);
        combinedDateTime.setHours(hour);
        combinedDateTime.setMinutes(minute);
        combinedDateTime.setSeconds(0);
        this.onChange(combinedDateTime);
      } else {
        this.onChange(null);
      }
    });
  }

  writeValue(value: Date | null): void {
    if (value) {
      this.form.setValue({
        date: value,
        hour: value.getHours(),
        minute: value.getMinutes()
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
    this.onTouched();
  }
}
