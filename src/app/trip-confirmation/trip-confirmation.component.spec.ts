import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { DataService } from '../services/data.service';
import { MatDialog } from '@angular/material/dialog';
import { AuthService } from '../auth/auth';

import { TripConfirmationComponent } from './trip-confirmation.component';

describe('TripConfirmationComponent', () => {
  let component: TripConfirmationComponent;
  let fixture: ComponentFixture<TripConfirmationComponent>;

  beforeEach(async () => {
    // Mock services to satisfy the component's dependencies
    const mockDataService = {
      getUnifiedTripLog: () => of([]) // Return an empty array observable
    };
    const mockAuthService = {
      currentUserSig: () => null // Mock the signal for the current user
    };

    await TestBed.configureTestingModule({
      imports: [TripConfirmationComponent, NoopAnimationsModule],
      providers: [
        { provide: DataService, useValue: mockDataService },
        { provide: MatDialog, useValue: {} }, // Empty object is often sufficient for basic tests
        { provide: AuthService, useValue: mockAuthService }
      ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(TripConfirmationComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
