import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CreateChargeDialogComponent } from './create-charge-dialog.component';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

/**
 * LEARNING: PROPER SPEC FILE STRUCTURE
 * 
 * CRITICAL MISTAKE TO AVOID:
 * - Never redefine the component class in the spec file
 * - Always import the actual component from its .component.ts file
 * 
 * WHY THIS MATTERS:
 * - Duplicate component definitions confuse TypeScript's type checker
 * - Template type-checking may use the wrong (incomplete) definition
 * - Results in errors like "Property 'filteredPilots' does not exist"
 * 
 * PROPER PATTERN:
 * 1. Import the real component class
 * 2. Provide mocks for dependencies (MatDialogRef, MAT_DIALOG_DATA, etc.)
 * 3. Write tests against the real implementation
 * 
 * This ensures your tests validate the actual component behavior
 * and TypeScript always has a single source of truth for type checking.
 */

describe('CreateChargeDialogComponent', () => {
  let component: CreateChargeDialogComponent;
  let fixture: ComponentFixture<CreateChargeDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        CreateChargeDialogComponent, // Standalone component import
        NoopAnimationsModule
      ],
      providers: [
        {
          provide: MatDialogRef,
          useValue: {
            close: jasmine.createSpy('close')
          }
        },
        {
          provide: MAT_DIALOG_DATA,
          useValue: null // Can be customized per test
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(CreateChargeDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should have the correct title for new charge mode', () => {
    expect(component.title).toBe('Create New Trip');
  });

  it('should initialize the form with required fields', () => {
    expect(component.form.get('ship')).toBeDefined();
    expect(component.form.get('gt')).toBeDefined();
    expect(component.form.get('boarding')).toBeDefined();
    expect(component.form.get('port')).toBeDefined();
    expect(component.form.get('pilot')).toBeDefined();
    expect(component.form.get('typeTrip')).toBeDefined();
  });

  it('should mark form as invalid when required fields are empty', () => {
    component.form.patchValue({
      ship: '',
      gt: null,
      boarding: null,
      port: null,
      pilot: '',
      typeTrip: ''
    });
    expect(component.form.valid).toBeFalse();
  });
});
