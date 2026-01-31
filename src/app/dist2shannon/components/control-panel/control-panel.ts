import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatSliderModule } from '@angular/material/slider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MaritimeCalculatorService } from '../../services/maritime-calculator.service';
import { CalculationResult, ShipPosition, Waypoint } from '../../interfaces/waypoint';
import { Observable } from 'rxjs';
import { take } from 'rxjs/operators';

import { DistanceRepository } from '../../../services/repositories/distance.repository';

import { AuthService } from '../../../auth/auth';
import { HelpDialogComponent } from '../help-dialog/help-dialog.component';

@Component({
  selector: 'app-control-panel',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatSliderModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatSnackBarModule
  ],
  templateUrl: './control-panel.html',
  styleUrl: './control-panel.scss'
})
export class ControlPanelComponent implements OnInit {

  // Default position values - used for both initialization and reset
  private readonly defaultPosition: ShipPosition = {
    lat: 53, latmin: 0, long: 10, longmin: 0, speed: 10, delay_hrs: 0, delay_mns: 0
  };

  // Current position - spread from defaults to create a new object
  position: ShipPosition = { ...this.defaultPosition };

  calculation$: Observable<CalculationResult>;
  waypoints: Waypoint[];
  pastedCoordinates = '';

  shipName = '';
  isSaving = false;

  constructor(
    private maritimeService: MaritimeCalculatorService,
    private distanceRepository: DistanceRepository,
    private authService: AuthService,
    private dialog: MatDialog,
    private snackBar: MatSnackBar
  ) {
    this.calculation$ = this.maritimeService.getCalculation();
    this.waypoints = this.maritimeService.getWaypoints();
  }

  openHelp() {
    this.dialog.open(HelpDialogComponent, {
      width: '800px',
      maxHeight: '90vh'
    });
  }

  ngOnInit(): void {
    this.maritimeService.getPosition().subscribe(pos => {
      this.position = { ...pos };
    });
  }

  onPositionChange() {
    this.maritimeService.updatePosition(this.position);
  }

  /**
   * Resets all form fields to their default values.
   * Called after successful save, or manually by user via Clear button.
   */
  resetForm(): void {
    // Reset position to defaults (spread to create new object, not reference)
    this.position = { ...this.defaultPosition };
    
    // Clear text inputs
    this.shipName = '';
    this.pastedCoordinates = '';
    
    // Notify the maritime service to recalculate with default position
    this.onPositionChange();
  }

  onPasteCoordinates(event: ClipboardEvent) {
    event.preventDefault();
    const clipboardData = event.clipboardData || (window as any).clipboardData;
    const pastedText = clipboardData.getData('text');
    this.pastedCoordinates = pastedText;
    this.parseCoordinates(pastedText);
  }

  parseCoordinates(text: string) {
    const parts = text.split(',').map(p => p.trim());
    if (parts.length >= 2) {
      const latRaw = parseFloat(parts[0]);
      const longRaw = parseFloat(parts[1]);

      if (!isNaN(latRaw) && !isNaN(longRaw)) {
        // Latitude
        this.position.lat = Math.floor(latRaw);
        this.position.latmin = (latRaw - this.position.lat) * 60;

        // Longitude (assuming input is negative for West, but app uses positive for West)
        const absLong = Math.abs(longRaw);
        this.position.long = Math.floor(absLong);
        this.position.longmin = (absLong - this.position.long) * 60;

        this.onPositionChange();
      }
    }
  }

  async saveCalculation() {
    if (!this.shipName) {
      // Show validation error using MatSnackBar - auto-dismisses after 5 seconds
      this.snackBar.open('Please enter a Ship Name', 'Close', { duration: 5000 });
      return;
    }

    this.isSaving = true;
    this.calculation$.pipe(take(1)).subscribe(async calc => {
      if (calc) {
        try {
          console.log('Attempting to save calculation:', this.shipName);
          const currentUser = this.authService.currentUserSig();
          const docId = await this.distanceRepository.addDistance({
            shipName: this.shipName,
            position: this.position,
            calculatedAt: calc.fromTime,
            nextWaypoint: calc.nextWP,
            distToScattery: calc.distToScattery,
            speed: this.position.speed,
            etaKilcredaun: calc.etaKil,
            etaScattery: calc.etaScattery,
            user: currentUser ? currentUser.displayName : 'Unknown'
          });
          console.log('Calculation saved with ID:', docId);
          // Show success message using MatSnackBar - auto-dismisses after 5 seconds
          this.snackBar.open('Calculation saved successfully!', 'Close', { duration: 5000 });
          // Reset all form fields for a fresh calculation
          this.resetForm();
        } catch (error) {
          console.error('Error saving calculation:', error);
          // Show error using MatSnackBar - 8 seconds since errors need more attention
          this.snackBar.open('Failed to save calculation. Check console for details.', 'Close', { duration: 8000 });
        } finally {
          this.isSaving = false;
        }
      }
    });
  }

  formatLabel(value: number): string {
    return `${value}`;
  }

  get saveTooltip(): string {
    if (this.isSaving) return 'Saving...';
    if (!this.shipName) return 'Enter Ship Name to Save';
    return 'Save Calculation';
  }
}
