import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { DataService } from '../services/data.service';
import { AuthService } from '../auth/auth';

import { MainComponent } from './main';

describe('MainComponent', () => {
  let component: MainComponent;
  let fixture: ComponentFixture<MainComponent>;

  beforeEach(async () => {
    const dataServiceMock = {
      getRecentTrips: () => of([]),
    };
    const authServiceMock = {
      currentUserSig: () => null,
    };

    await TestBed.configureTestingModule({
      imports: [MainComponent, NoopAnimationsModule],
      providers: [
        { provide: DataService, useValue: dataServiceMock },
        { provide: AuthService, useValue: authServiceMock },
        { provide: MatDialog, useValue: {} },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MainComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
