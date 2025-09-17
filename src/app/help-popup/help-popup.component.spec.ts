import { ComponentFixture, TestBed } from '@angular/core/testing';

import { HelpPopup } from './help-popup.component';

describe('HelpPopup', () => {
  let component: HelpPopup;
  let fixture: ComponentFixture<HelpPopup>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HelpPopup]
    })
    .compileComponents();

    fixture = TestBed.createComponent(HelpPopup);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
