
import { DatePipe } from '@angular/common';
import { CsvExportService } from './csv-export.service' ;
import { TripWithWarnings } from './data-quality.service';
import * as Papa from 'papaparse';
import {TestBed} from '@angular/core/testing';

describe('CsvExportService', () => {
  let service: CsvExportService;
  let datePipe: DatePipe;

  const mockTrip: TripWithWarnings = {
    id: '1',
    ship: 'Test Ship',
    gt: 1000,
    boarding: new Date('2023-10-27T10:00:00.000Z'),
    typeTrip: 'In',
    port: 'Foynes', // Corrected to use a valid 'Port' type. 'Test Port' is not a valid Port.
    pilot: 'Test Pilot',
    isActionable: false,
    dataWarnings: ['(E1) A warning'],
    sailingNote: 'A note.',
    extra: 'Detention',
    updateTime: new Date('2023-10-27T11:00:00.000Z'),
    updatedBy: 'user',
    chargeableEvent: undefined,
    source: 'Charge'
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [DatePipe] // Provide DatePipe for the test environment
    });
    service = TestBed.inject(CsvExportService);
    datePipe = TestBed.inject(DatePipe);

    // Mock DOM methods
    spyOn(document.body, 'appendChild').and.stub();
    spyOn(document.body, 'removeChild').and.stub();
    spyOn(URL, 'createObjectURL').and.returnValue('blob:http://localhost/mock-url');
    spyOn(URL, 'revokeObjectURL').and.stub();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('exportConfirmedTrips', () => {
    it('should map trips to CSV data and trigger download', () => {
      const mapSpy = spyOn<any>(service, 'mapTripsToCsvData').and.callThrough();
      const downloadSpy = spyOn<any>(service, 'downloadCsv').and.stub();
      const trips = [mockTrip];

      service.exportConfirmedTrips(trips);

      expect(mapSpy).toHaveBeenCalledWith(trips);
      expect(downloadSpy).toHaveBeenCalled();
    });

    it('should call Papa.unparse with the mapped data', () => {
      const unparseSpy = spyOn(Papa, 'unparse');
      const mappedData = [{ 'Ship': 'Test' }];
      spyOn<any>(service, 'mapTripsToCsvData').and.returnValue(mappedData);
      spyOn<any>(service, 'downloadCsv').and.stub();

      service.exportConfirmedTrips([mockTrip]);

      expect(unparseSpy).toHaveBeenCalledWith(mappedData);
    });
  });

  describe('mapTripsToCsvData (private)', () => {
    it('should correctly format a trip for CSV', () => {
      const result = (service as any).mapTripsToCsvData([mockTrip]);

      expect(result[0]).toEqual({
        'Timestamp': datePipe.transform(mockTrip.updateTime, 'dd-MM-yy HH:mm:ss'),
        'Ship': 'Test Ship',
        'GT': 1000,
        'Date': datePipe.transform(mockTrip.boarding, 'dd/MM/yy'),
        'In / Out': 'In',
        'To/From': 'Test Port',
        'Late Order / Detention /Anchoring etc': 'Detention',
        'Pilot': 'Test Pilot',
        'Note': '[(E1) A warning] A note.'
      });
    });
  });

  describe('downloadCsv (private)', () => {
    it('should create, click, and remove a download link', () => {
      const link = {
        setAttribute: jasmine.createSpy('setAttribute'),
        click: jasmine.createSpy('click'),
        style: { visibility: '' }
      };
      spyOn(document, 'createElement').and.returnValue(link as any);
      const csvString = 'header\nvalue';
      const filename = 'test.csv';

      (service as any).downloadCsv(csvString, filename);

      expect(document.createElement).toHaveBeenCalledWith('a');
      expect(link.setAttribute).toHaveBeenCalledWith('href', 'blob:http://localhost/mock-url');
      expect(link.setAttribute).toHaveBeenCalledWith('download', filename);
      expect(link.style.visibility).toBe('hidden');
      expect(document.body.appendChild).toHaveBeenCalledWith(link as any);
      expect(link.click).toHaveBeenCalled();
      expect(document.body.removeChild).toHaveBeenCalledWith(link as any);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/mock-url');
    });
  });
});
