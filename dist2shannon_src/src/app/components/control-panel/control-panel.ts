import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatSliderModule } from '@angular/material/slider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MaritimeCalculatorService } from '../../services/maritime-calculator.service';
import { CalculationResult, ShipPosition, Waypoint } from '../../interfaces/waypoint';
import { Observable } from 'rxjs';
import { take } from 'rxjs/operators';

@Component({
  selector: 'app-control-panel',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatSliderModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule
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

  constructor(private maritimeService: MaritimeCalculatorService) {
    this.calculation$ = this.maritimeService.getCalculation();
    this.waypoints = this.maritimeService.getWaypoints();
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



  marineDistanceResult: any = null;
  isLoadingMarineDistance = false;

  calculateMarineDistance() {
    this.isLoadingMarineDistance = true;
    this.marineDistanceResult = null;

    // We need the current calculation to get the next waypoint
    // We can subscribe once to get the latest value
    this.calculation$.subscribe(calc => {
      if (calc && calc.nextWP) {
        const lat1 = this.position.lat + (this.position.latmin / 60);
        const lon1 = -(this.position.long + (this.position.longmin / 60)); // West is negative
        const lat2 = calc.nextWP.lat;
        const lon2 = calc.nextWP.long;

        this.maritimeService.getMarineDistance(lat1, lon1, lat2, lon2).subscribe({
          next: (res) => {
            this.marineDistanceResult = res;
            this.isLoadingMarineDistance = false;
          },
          error: (err) => {
            console.error('API Error', err);
            this.isLoadingMarineDistance = false;
            // Mock result for testing if API fails (or if key is invalid)
            // this.marineDistanceResult = { route: { distance: 12345 } }; 
          }
        });
      }
    }).unsubscribe();
  }

  formatLabel(value: number): string {
    return `${value}`;
  }
}
