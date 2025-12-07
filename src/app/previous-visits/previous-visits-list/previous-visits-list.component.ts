import { Component, Input, OnInit, ViewChild, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';

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
  @Input() set data(value: any[]) {
    this.dataSource.data = value;
  }

  dataSource = new MatTableDataSource<any>();
  displayedColumns: string[] = ['displayDate', 'shipName', 'grossTonnage', 'arrivedDate', 'inwardPilot', 'inwardPort', 'sailedDate', 'outwardPilot', 'outwardPort'];
  
  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort!: MatSort;

  constructor(private router: Router) {}

  ngOnInit() {}

  ngAfterViewInit() {
    this.dataSource.paginator = this.paginator;
    this.dataSource.sort = this.sort;
  }

  applyFilter(event: Event) {
    const filterValue = (event.target as HTMLInputElement).value;
    this.dataSource.filter = filterValue.trim().toLowerCase();

    if (this.dataSource.paginator) {
      this.dataSource.paginator.firstPage();
    }
  }

  editVisit(row: any) {
    this.router.navigate(['edit', row.visitId]);
  }
}
