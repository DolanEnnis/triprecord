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
    MatTooltipModule
  ],
  templateUrl: './control-panel.html',
  styleUrl: './control-panel.scss'
})
export class ControlPanelComponent implements OnInit {

  position: ShipPosition = {
    lat: 53, latmin: 0, long: 10, longmin: 0, speed: 10, delay_hrs: 0, delay_mns: 0
  };

  calculation$: Observable<CalculationResult>;
  waypoints: Waypoint[];
  pastedCoordinates = '';

  shipName = '';
  isSaving = false;

  constructor(
    private maritimeService: MaritimeCalculatorService,
    private distanceRepository: DistanceRepository,
    private authService: AuthService,
    private dialog: MatDialog
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
      alert('Please enter a Ship Name');
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
          alert('Calculation saved successfully!');
          this.shipName = ''; // Reset ship name
        } catch (error) {
          console.error('Error saving calculation:', error);
          alert('Failed to save calculation. Check console for details.');
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
