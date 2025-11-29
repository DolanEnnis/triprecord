import { Component, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GoogleMapsModule, MapInfoWindow, MapMarker } from '@angular/google-maps';
import { MaritimeCalculatorService } from '../../services/maritime-calculator.service';
import { ShipPosition, Waypoint } from '../../interfaces/waypoint';

@Component({
  selector: 'app-map',
  standalone: true,
  imports: [CommonModule, GoogleMapsModule],
  templateUrl: './map.html',
  styleUrl: './map.scss'
})
export class MapComponent implements OnInit {

  center: google.maps.LatLngLiteral = { lat: 52.53333, lng: -10 };
  zoom = 8;

  shipPosition: google.maps.LatLngLiteral = { lat: 52.53333, lng: -10 };
  waypoints: Waypoint[] = [];

  markerOptions: google.maps.MarkerOptions = { draggable: false };
  shipMarkerOptions: google.maps.MarkerOptions = {
    draggable: false,
    icon: 'http://maps.google.com/mapfiles/ms/icons/blue-dot.png',
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

  updateShipPosition(pos: ShipPosition) {
    const lat = pos.lat + (pos.latmin / 60);
    const lng = -(pos.long + (pos.longmin / 60)); // Longitude is negative for West

    this.shipPosition = { lat, lng };
    this.center = { lat, lng };

    // Trigger polyline update with current nextWP if available
    // Note: We rely on the calculation subscription to handle the full update,
    // but we need to ensure shipPosition is set first.
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
