import { Component, OnInit, ViewChild, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GoogleMapsModule, MapInfoWindow, MapMarker, GoogleMap } from '@angular/google-maps';
import { MaritimeCalculatorService } from '../../services/maritime-calculator.service';
import { ShipPosition, Waypoint } from '../../interfaces/waypoint';

@Component({
  selector: 'app-map',
  standalone: true,
  imports: [CommonModule, GoogleMapsModule],
  templateUrl: './map.html',
  styleUrl: './map.scss'
})
export class MapComponent implements OnInit, AfterViewInit {

  center: google.maps.LatLngLiteral = { lat: 52.53333, lng: -10 };
  zoom = 8;

  shipPosition: google.maps.LatLngLiteral = { lat: 52.53333, lng: -10 };
  waypoints: Waypoint[] = [];

  markerOptions: google.maps.MarkerOptions = { draggable: false };
  shipMarkerOptions: google.maps.MarkerOptions = {
    draggable: false,
    icon: {
      path: 'M 0,0 m -8,0 a 8,8 0 1,0 16,0 a 8,8 0 1,0 -16,0', // SVG circle path
      fillColor: '#1976D2', // Nautical blue
      fillOpacity: 1,
      strokeColor: '#FFFFFF',
      strokeWeight: 2,
      scale: 1.5
    },
    title: 'Ship Position'
  };

  polylineOptions: google.maps.PolylineOptions = {
    strokeColor: '#FF0000',
    strokeOpacity: 1.0,
    strokeWeight: 2,
  };

  polylinePath: google.maps.LatLngLiteral[] = [];

  constructor(private maritimeService: MaritimeCalculatorService) { }

  ngOnInit(): void {
    this.waypoints = this.maritimeService.getWaypoints();

    this.maritimeService.getPosition().subscribe(pos => {
      this.updateShipPosition(pos);
    });

    this.maritimeService.getCalculation().subscribe(calc => {
      if (calc && calc.nextWP) {
        this.updatePolyline(calc.nextWP);
      }
    });
  }

  ngAfterViewInit() {
    this.fitMapBounds();
  }

  @ViewChild(GoogleMap) map!: GoogleMap;

  updateShipPosition(pos: ShipPosition) {
    const lat = pos.lat + (pos.latmin / 60);
    const lng = -(pos.long + (pos.longmin / 60)); // Longitude is negative for West

    this.shipPosition = { lat, lng };
    this.fitMapBounds();
  }

  private fitMapBounds() {
    // Find Kilcreadaun waypoint
    const kilcreadaun = this.waypoints.find(wp => wp.name === 'Kilcreadaun');
    
    if (this.map && kilcreadaun && this.shipPosition) {
      const bounds = new google.maps.LatLngBounds();
      bounds.extend(this.shipPosition);
      bounds.extend({ lat: kilcreadaun.lat, lng: kilcreadaun.long });
      this.map.fitBounds(bounds, 50); // Add padding
    }
  }

  updatePolyline(nextWP: Waypoint) {
    this.polylinePath = [
      this.shipPosition,
      { lat: nextWP.lat, lng: nextWP.long }
    ];
  }

  onMarkerClick(wp: Waypoint) {
    this.maritimeService.updateWaypoint(wp);
  }
}
