import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl,ReactiveFormsModule } from '@angular/forms';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatTableModule } from '@angular/material/table';
import { MatIconModule } from '@angular/material/icon';
import { Router } from '@angular/router';
import { ShipRepository } from '../services/ship.repository';
import { Observable, of } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap } from 'rxjs/operators';

@Component({
  selector: 'app-ships',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatInputModule,
    MatFormFieldModule,
    MatTableModule,
    MatIconModule
  ],
  templateUrl: './ships.component.html',
  styleUrls: ['./ships.component.css']
})
export class ShipsComponent {
  searchControl = new FormControl('');
  ships$!: Observable<{ ship: string; gt: number; id: string }[]>;
  displayedColumns = ['shipName', 'grossTonnage'];
  searching = false;

  constructor(
    private shipRepository: ShipRepository,
    private router: Router
  ) {
    // Search as user types (with 3 char minimum)
    this.ships$ = this.searchControl.valueChanges.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      switchMap(search => {
        if (!search || search.length < 3) {
          return of([]);
        }
        this.searching = true;
        return this.shipRepository.getShipSuggestions(search);
      })
    );
  }

  viewShipVisits(shipId: string, shipName: string) {
    // Navigate to previous page filtered by this ship
    // For now, just navigate to edit - we can enhance this later
    console.log('View visits for ship:', shipId, shipName);
    // TODO: Navigate to a ship details page or filtered previous visits
  }
}
