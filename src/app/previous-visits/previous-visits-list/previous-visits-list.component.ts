import { Component, Input, OnInit, ViewChild, AfterViewInit, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatCardModule } from '@angular/material/card';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { EnrichedVisit } from '../../models';

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
    FormsModule,
    MatCardModule
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
    this.scrollToBoundary();
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
    this.scrollToBoundary();
  }
  
  public get currentSortOrder() {
    return this._sortOrder;
  }
  
  @Input() enableAutoScroll: boolean = false;

  private _sortOrder: 'inward' | 'sailing' = 'inward';

  @Output() visitClicked = new EventEmitter<EnrichedVisit>();

  dataSource = new MatTableDataSource<EnrichedVisit>();
  displayedColumns: string[] = ['initialEta', 'shipName', 'inwardPort', 'status', 'arrivedDate', 'inwardPilot', 'spacer', 'sailedDate', 'outwardPilot'];
  
  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort!: MatSort;

  constructor(private router: Router) {}

  ngOnInit() {}

  ngAfterViewInit() {
    this.dataSource.paginator = this.paginator;
    this.dataSource.sort = this.sort;
    
    // LEARNING: THE ROLE OF sortingDataAccessor
    // This function's only job is to return a COMPARABLE VALUE for a given property.
    // MatSort then handles the direction (asc/desc) entirely on its own.
    // NEVER check `this.sort.direction` inside here — that creates a circular dependency
    // where the value you return changes based on the sort state, confusing the sort pipeline.
    this.dataSource.sortingDataAccessor = (item: EnrichedVisit, property: string) => {
      if (property === 'sailedDate') {
        // Return 0 for null dates so they sort consistently to one end.
        // MatSort's direction setting decides whether 0 ends up at the top or bottom.
        return item.sailedDate ? item.sailedDate.getTime() : 0;
      }
      if (property === 'arrivedDate') {
        return item.arrivedDate ? item.arrivedDate.getTime() : 0;
      }
      if (property === 'initialEta') {
        return item.initialEta ? item.initialEta.getTime() : 0;
      }
      // Default: return the raw property value for string/number columns
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
      this.scrollToBoundary();
    });
  }

  private scrollToBoundary() {
    if (!this.enableAutoScroll) {
      return;
    }
    setTimeout(() => {
      // 1. Find the boundary visit ID
      const boundaryId = this.findBoundaryVisitId();
      if (boundaryId && this.paginator && this.dataSource.sort) {
        // 2. Get sorted data to find its exact index across all pages
        const sortedData = this.dataSource.sortData(this.dataSource.filteredData, this.dataSource.sort);
        const index = sortedData.findIndex(v => v.visitId === boundaryId);
        
        if (index >= 0) {
          // 3. Calculate target page
          const targetPage = Math.floor(index / this.paginator.pageSize);
          if (this.paginator.pageIndex !== targetPage) {
            this.paginator.pageIndex = targetPage;
            // Re-assign paginator to trigger a re-slice of the data for the new page
            this.dataSource.paginator = this.paginator;
          }
        }
      }

      // 4. Wait for the DOM to render the boundary row/card on the active page, then scroll.
      // LEARNING: We use offsetParent !== null to distinguish "visible" from "hidden" elements.
      // When on mobile, the desktop table is display:none so its rows have offsetParent === null
      // and are skipped. The visible mobile card is found instead — and vice versa on desktop.
      // We use 200ms here (not 100ms) because on mobile the *ngFor async pipe needs a full
      // change-detection cycle to render the new page's cards after a paginator jump.
      setTimeout(() => {
        const elements = document.querySelectorAll('.current-time-boundary');
        for (let i = 0; i < elements.length; i++) {
          const el = elements[i] as HTMLElement;
          if (el.offsetParent !== null) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            break;
          }
        }
      }, 200);
    }, 400); // Delay to allow initial sort/filter to settle
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
        // LEARNING: Mutating MatSort properties programmatically does NOT fire its sortChange event. 
        // We MUST manually emit it so that MatTableDataSource knows to re-run the sort pipeline and push new data to the async pipe!
        this.sort.sortChange.emit({ active: this.sort.active, direction: this.sort.direction });
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

  private findBoundaryVisitId(): string | null {
    const nowTime = Date.now();
    const dateField = this._sortOrder === 'inward' ? 'initialEta' : 'sailedDate';
    const allData = this.dataSource.filteredData;
    let earliestFutureEta = Number.MAX_SAFE_INTEGER;
    let earliestFutureVisitId: string | null = null;
    
    for (const visit of allData) {
      const eta = visit[dateField]?.getTime();
      if (eta && eta > nowTime && eta < earliestFutureEta) {
        earliestFutureEta = eta;
        earliestFutureVisitId = visit.visitId;
      }
    }
    
    return earliestFutureVisitId;
  }

  isCurrentTimeBoundary(row: EnrichedVisit, index: number): boolean {
    return this.findBoundaryVisitId() === row.visitId;
  }

  editVisit(row: EnrichedVisit) {
    if (this.visitClicked.observed) {
      this.visitClicked.emit(row);
    } else {
      this.router.navigate(['edit', row.visitId]);
    }
  }
}
