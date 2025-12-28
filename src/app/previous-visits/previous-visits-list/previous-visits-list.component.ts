import { Component, Input, OnInit, ViewChild, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { EnrichedVisit } from '../../models/enriched-visit.model';

@Component({
  selector: 'app-previous-visits-list',
  standalone: true,
  imports: [
    CommonModule,
    MatTableModule,
    MatPaginatorModule,
    MatSortModule,
    MatInputModule,
    MatFormFieldModule,
    FormsModule
  ],
  templateUrl: './previous-visits-list.component.html',
  styleUrls: ['./previous-visits-list.component.css']
})
export class PreviousVisitsListComponent implements OnInit, AfterViewInit {
  @Input() set data(value: EnrichedVisit[]) {
    this.dataSource.data = value;
    // Apply the current sort configuration
    if (this.sort) {
      if (this._sortOrder === 'inward') {
        this.sort.active = 'initialEta';
        this.sort.direction = 'desc';
      } else {
        this.sort.active = 'sailedDate';
        this.sort.direction = 'desc';
      }
      this.dataSource.sort = this.sort;
    }
  }

  @Input() set filterValue(value: string) {
    this.dataSource.filter = value.trim().toLowerCase();
    if (this.dataSource.paginator) {
      this.dataSource.paginator.firstPage();
    }
  }

  @Input() highlightMode: '2' | '3' = '3';
  
  @Input() set sortOrder(value: 'inward' | 'sailing') {
    this._sortOrder = value;
    this.applySortIfReady();
  }
  
  private _sortOrder: 'inward' | 'sailing' = 'inward';

  dataSource = new MatTableDataSource<EnrichedVisit>();
  displayedColumns: string[] = ['initialEta', 'shipName', 'inwardPort', 'status', 'arrivedDate', 'inwardPilot', 'spacer', 'sailedDate', 'outwardPilot'];
  
  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort!: MatSort;

  constructor(private router: Router) {}

  ngOnInit() {}

  ngAfterViewInit() {
    this.dataSource.paginator = this.paginator;
    this.dataSource.sort = this.sort;
    
    // Custom sorting to handle null sailing dates
    // LEARNING: CUSTOM SORT FOR INCOMPLETE RECORDS
    // Ships marked "Sailed" but missing sailedDate are incomplete - push to end
    this.dataSource.sortingDataAccessor = (item: EnrichedVisit, property: string) => {
      if (property === 'sailedDate') {
        // CRITICAL: If status is "Sailed" but no sailedDate, it's an incomplete record
        // Push these to the BOTTOM regardless of sort direction (out of sight but not forgotten)
        if (!item.sailedDate) {
          // Return far future date to always sort to bottom
          return new Date(9999, 11, 31);
        }
        return item.sailedDate;
      }
      
      // For arrivedDate, also handle nulls similarly
      if (property === 'arrivedDate') {
        if (!item.arrivedDate) {
          return this.sort?.direction === 'asc' ? new Date(0) : new Date(9999, 11, 31);
        }
        return item.arrivedDate;
      }
      
      // For initialEta
      if (property === 'initialEta') {
        if (!item.initialEta) {
          return this.sort?.direction === 'asc' ? new Date(0) : new Date(9999, 11, 31);
        }
        return item.initialEta;
      }
      
      // Default accessor for other properties
      return (item as any)[property];
    };
    
    // Defer initial sort to next tick to avoid ExpressionChangedAfterItHasBeenCheckedError
    setTimeout(() => {
      // Set default sort to Date (initialEta) descending
      if (this.sort) {
        this.sort.active = 'initialEta';
        this.sort.direction = 'desc';
        this.dataSource.sort = this.sort;
      }

      // Set default page size to 25
      if (this.paginator) {
        this.paginator.pageSize = 25;
      }
    });
  }

  // Helper method to apply sort configuration
  private applySortIfReady() {
    // Use setTimeout to avoid ExpressionChangedAfterItHasBeenCheckedError
    setTimeout(() => {
      if (this.sort) {
        if (this._sortOrder === 'inward') {
          this.sort.active = 'initialEta';
          this.sort.direction = 'desc';
        } else {
          this.sort.active = 'sailedDate';
          this.sort.direction = 'desc';
        }
        this.dataSource.sort = this.sort;
      }
    }, 0);
  }

  getRowClass(index: number): string {
    if (this.highlightMode === '2') {
      return index % 2 === 0 ? 'row-even' : 'row-odd';
    } else {
      const mod = index % 3;
      if (mod === 0) return 'row-color-1';
      if (mod === 1) return 'row-color-2';
      return 'row-color-3';
    }
  }

  isCurrentTimeBoundary(row: EnrichedVisit, index: number): boolean {
    const nowTime = Date.now();
    
    // Determine which date field to use based on sort order
    const dateField = this._sortOrder === 'inward' ? 'initialEta' : 'sailedDate';
    const currentEta = row[dateField]?.getTime();
    
    if (!currentEta) return false;
    
    // Check if this row is in the FUTURE
    const currentIsInFuture = currentEta > nowTime;
    if (!currentIsInFuture) return false; // Only FUTURE rows can have the boundary
    
    // CRITICAL FIX: Find the EARLIEST (chronologically closest to now) FUTURE ship
    // With descending sort (newest first), this ship appears at the BOTTOM of future ships
    // The boundary line should appear BELOW it, separating future from past
    const allData = this.dataSource.filteredData;
    let earliestFutureEta = Number.MAX_SAFE_INTEGER; // Start with max, find minimum
    let earliestFutureVisitId: string | null = null;
    
    for (const visit of allData) {
      const eta = visit[dateField]?.getTime();
      // Find the SMALLEST future ETA (closest to now)
      if (eta && eta > nowTime && eta < earliestFutureEta) {
        earliestFutureEta = eta;
        earliestFutureVisitId = visit.visitId;
      }
    }
    
    // The line appears on the ship closest to "now" (earliest future ship)
    return earliestFutureVisitId === row.visitId;
  }

  editVisit(row: EnrichedVisit) {
    this.router.navigate(['edit', row.visitId]);
  }
}
