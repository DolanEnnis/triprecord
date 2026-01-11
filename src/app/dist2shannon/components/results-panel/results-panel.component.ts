import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MaritimeCalculatorService } from '../../services/maritime-calculator.service';
import { Observable } from 'rxjs';
import { CalculationResult, ShipPosition } from '../../interfaces/waypoint';

@Component({
  selector: 'app-results-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './results-panel.component.html',
  styleUrl: './results-panel.component.scss'
})
export class ResultsPanelComponent implements OnInit {

  calculation$: Observable<CalculationResult>;
  position$: Observable<ShipPosition>;
  
  constructor(private maritimeService: MaritimeCalculatorService) {
    this.calculation$ = this.maritimeService.getCalculation();
    this.position$ = this.maritimeService.getPosition();
  }

  ngOnInit(): void {
  }
}
