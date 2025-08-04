import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { MatSidenavModule } from '@angular/material/sidenav';
import { HeaderComponent } from './navigation/header/header';
import { SidenavListComponent } from './navigation/sidenav-list/sidenav-list';
import { FooterComponent } from './footer/footer'; // 1. Import the footer

@Component({
  selector: 'app-root',
  standalone: true,

  imports: [RouterOutlet,
            MatSidenavModule,
            HeaderComponent,
            SidenavListComponent,
            FooterComponent],
  templateUrl: './app.html',
  styleUrls: ['./app.css'],
})
export class AppComponent {
  title = 'triprecord';
}
