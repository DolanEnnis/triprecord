import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { DistanceRepository } from '../../../services/repositories/distance.repository';
import { Distance } from '../../../models';
import { Observable } from 'rxjs';
import { TimeAgoPipe } from '../../../shared/pipes/time-ago.pipe';

@Component({
  selector: 'app-history-table',
  standalone: true,
  imports: [CommonModule, MatTableModule, TimeAgoPipe],
  templateUrl: './history-table.component.html',
  styleUrl: './history-table.component.scss'
})
export class HistoryTableComponent implements OnInit {
  history$: Observable<Distance[]>;
  displayedColumns: string[] = ['shipName', 'calculatedAt', 'timeAgo', 'coords', 'distToScattery', 'speed', 'etaScattery', 'user'];

  constructor(private distanceRepository: DistanceRepository) {
    this.history$ = this.distanceRepository.getHistory();
  }

  ngOnInit(): void {}

  formatCoords(pos: any): string {
    if (!pos) return '';
    const lat = pos.lat + (pos.latmin / 60);
    const long = pos.long + (pos.longmin / 60);
    return `${lat.toFixed(4)}, -${long.toFixed(4)}`;
  }
}
