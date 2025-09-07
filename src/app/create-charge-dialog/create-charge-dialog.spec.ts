import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { DataService } from '../services/data.service';

import { CreateChargeDialogComponent } from './create-charge-dialog';

describe('CreateChargeDialogComponent', () => {
  let component: CreateChargeDialogComponent;
  let fixture: ComponentFixture<CreateChargeDialogComponent>;

  beforeEach(async () => {
    // Mock for the DataService to avoid making real database calls
    const dataServiceMock = {
      createChargeAndUpdateVisit: () => Promise.resolve(),
    };

    await TestBed.configureTestingModule({
      // The component itself is imported because it's standalone
      imports: [CreateChargeDialogComponent, NoopAnimationsModule],
      providers: [
        // Provide mock versions of all the services the component injects
        { provide: MatDialogRef, useValue: {} },
        { provide: MAT_DIALOG_DATA, useValue: {} },
        { provide: DataService, useValue: dataServiceMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CreateChargeDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
