import { Component, computed, forwardRef, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';

import {
  ControlValueAccessor,
  FormBuilder,
  FormControl,
  FormGroup,
  NG_VALUE_ACCESSOR,
  ReactiveFormsModule,
  Validators
} from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';

// --- Angular Material & Core Imports ---
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDatepickerModule } from '@angular/material/datepicker';
import {  DateAdapter } from '@angular/material/core';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

// --- Type Definitions ---
// Strongly-typed interface for the date-time picker form
// This enables autocomplete and compile-time type checking
interface DateTimeForm {
  date: FormControl<Date | null>;
  hour: FormControl<string>;
  minute: FormControl<string>;
}

@Component({
  selector: 'app-date-time-picker',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatDatepickerModule,
    
    MatAutocompleteModule,
    MatIconModule,
    MatTooltipModule],
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
  // Use DateAdapter<Date> since we're working with native JavaScript Date objects
  private readonly adapter = inject(DateAdapter<Date>);

  // BreakpointObserver emits a stream of events when the screen crosses size thresholds.
  // toSignal() converts that Observable into a read-only Signal automatically — no
  // manual subscribe/unsubscribe needed, Angular cleans it up for us.
  private readonly breakpointObserver = inject(BreakpointObserver);
  readonly isLargeScreen = toSignal(
    // Breakpoints.Medium = '(min-width: 960px)' — same as Material's medium breakpoint
    this.breakpointObserver.observe(Breakpoints.Medium),
    { initialValue: { matches: window.innerWidth >= 960, breakpoints: {} } }
  );

  // Typed FormGroup provides autocomplete and type safety for form controls
  form: FormGroup<DateTimeForm>;

  // Autocomplete suggestions for quick time entry
  // Hours: All 24 hours (00-23) since ships can arrive at any time
  hours: { value: number; label: string }[] = Array.from({ length: 24 }, (_, i) => ({
    value: i,
    label: i.toString().padStart(2, '0')
  }));

  // Minutes: 10-minute intervals for quick selection, users can still type exact values
  minutes: { value: number; label: string }[] = Array.from({ length: 6 }, (_, i) => ({
    value: i * 10,
    label: (i * 10).toString().padStart(2, '0')
  }));

  onChange: (value: Date | null) => void = () => {};
  onTouched: () => void = () => {};

  /**
   * A writable signal that holds the currently-selected date from the form.
   *
   * WHY DO WE NEED THIS?
   * Angular's reactive forms (FormControl) work with Observables/RxJS, but
   * Angular's computed() can only track Signals. This private signal bridges
   * the two worlds: we write to it inside valueChanges (RxJS), and computed()
   * can read from it reactively.
   */
  private readonly _dateForLink = signal<Date | null>(null);

  /**
   * Derives the Calendar page URL from the selected date.
   * computed() re-runs automatically whenever _dateForLink() changes.
   *
   * WHY a string href rather than routerLink?
   * routerLink navigates within Angular's SPA but cannot open a new tab.
   * A native <a href="..."> is the only reliable, cross-browser way to
   * set target="_blank" and guarantee the new tab opens correctly.
   */
  readonly calendarHref = computed(() => {
    const date = this._dateForLink();
    if (!date) return null;

    // Build YYYY-MM-DD using local date parts — same timezone the picker displays in
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `/calendar/${y}-${m}-${d}`;
  });

  constructor() {
    this.adapter.setLocale('en-GB');

    // Use nonNullable FormBuilder to create controls that match our typed interface
    // This ensures hour and minute are always strings (never null)
    this.form = this.fb.nonNullable.group({
      date: [null as Date | null, Validators.required],
      hour: ['', [Validators.required, Validators.min(0), Validators.max(23)]],
      minute: ['', [Validators.required, Validators.min(0), Validators.max(59)]]
    });

    // Auto-fill time to 12:00 when a date is picked and time is empty
    this.form.controls.date.valueChanges.pipe(
      takeUntilDestroyed(),
    ).subscribe(dateValue => {
      if (dateValue) {
        const hourControl = this.form.controls.hour;
        const minuteControl = this.form.controls.minute;
        
        // Only auto-fill if both hour and minute are empty (not set by user)
        if (hourControl.value === '' && minuteControl.value === '') {
          this.form.patchValue({
            hour: '12',
            minute: '00'
          });
        }

        // Keep _dateForLink in sync so calendarHref() stays reactive.
        // We update the signal here inside the RxJS subscription, bridging
        // the reactive-forms world into the Signals world.
        this._dateForLink.set(dateValue);
      } else {
        this._dateForLink.set(null);
      }
    });

    this.form.valueChanges.pipe(
      takeUntilDestroyed(),
    ).subscribe(value => {
      if (this.form.valid) {
        const { date, hour, minute } = value;
        // Type guards: ensure values exist before parsing
        if (!date || hour === undefined || minute === undefined) {
          return;
        }
        
        // When form is valid, we know:
        // - date exists (required validator)
        // - hour is 0-23 (min/max validators)
        // - minute is 0-59 (min/max validators)
        const combinedDateTime = new Date(date);
        combinedDateTime.setHours(parseInt(hour, 10));
        combinedDateTime.setMinutes(parseInt(minute, 10));
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
        hour: String(value.getHours()).padStart(2, '0'),
        minute: String(value.getMinutes()).padStart(2, '0')
      }, { emitEvent: false });

      // Keep the link signal in sync when the form is written to externally
      // (e.g. when the parent component sets an initial value)
      this._dateForLink.set(value);
    } else {
      // Clear the form when value is null
      this.form.setValue({
        date: null,
        hour: '',
        minute: ''
      }, { emitEvent: false });
      this._dateForLink.set(null);
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
    const hourControl = this.form.controls.hour;
    const minuteControl = this.form.controls.minute;
    
    if (hourControl.value) {
      const hourNum = parseInt(hourControl.value, 10);
      if (!isNaN(hourNum) && hourNum >= 0 && hourNum <= 23) {
        hourControl.setValue(String(hourNum).padStart(2, '0'), { emitEvent: false });
      }
    }
    
    if (minuteControl.value) {
      const minuteNum = parseInt(minuteControl.value, 10);
      if (!isNaN(minuteNum) && minuteNum >= 0 && minuteNum <= 59) {
        minuteControl.setValue(String(minuteNum).padStart(2, '0'), { emitEvent: false });
      }
    }
    
    this.onTouched();
  }
}
