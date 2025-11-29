import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ControlPanelComponent } from './components/control-panel/control-panel';
import { MapComponent } from './components/map/map';
import { environment } from '../environments/environment';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, ControlPanelComponent, MapComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class AppComponent implements OnInit {
  title = 'dist2shannon';
  apiLoaded = false;

  ngOnInit() {
    this.loadGoogleMaps();
  }

  loadGoogleMaps() {
    if (document.getElementById('google-maps-script')) {
      this.apiLoaded = true;
      return;
    }
    const script = document.createElement('script');
    script.id = 'google-maps-script';
    script.src = `https://maps.googleapis.com/maps/api/js?key=${environment.googleMapsApiKey}`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      this.apiLoaded = true;
    };
    document.head.appendChild(script);
  }
}
