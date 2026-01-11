import { TestBed } from '@angular/core/testing';

import { DataQualityService } from './data-quality.service';

describe('DataQuality', () => {
  let service: DataQualityService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(DataQualityService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
