import { Component, inject } from '@angular/core';
import { MatToolbarModule } from '@angular/material/toolbar';
import { AuthService } from '../auth/auth';

/**
 * Represents an external link displayed in the footer.
 * Using an interface ensures type safety and makes the data structure explicit.
 */
interface ExternalLink {
  /** Display text for the link */
  label: string;
  /** Full URL to navigate to */
  url: string;
  /** Optional description for accessibility (screen readers) */
  description?: string;
}

@Component({
  selector: 'app-footer',
  standalone: true,
  imports: [
    MatToolbarModule,
  ],
  templateUrl: './footer.html',
  styleUrls: ['./footer.css']
})
export class FooterComponent {
  readonly authService = inject(AuthService);

  /**
   * External links displayed in the footer.
   * Benefits of this approach:
   * - Type-safe: TypeScript will catch errors if we add invalid links
   * - DRY: Security attributes (target, rel) defined once in template
   * - Maintainable: Adding/removing links = editing this array, not HTML structure
   * - Testable: Easy to verify the correct links are present
   */
  readonly externalLinks: ExternalLink[] = [
    {
      label: 'Cork',
      url: 'https://portofcork.maps.arcgis.com/apps/dashboards/7ced6a035753416e8108ae7a0490d980',
      description: 'Port of Cork ArcGIS Dashboard'
    },
    {
      label: "Brian's Tide",
      url: 'https://docs.google.com/spreadsheets/d/1g1Ct5rOanzwlQhjjbC9lcQgSzzqqkFWJFAk70gCWhWc/preview',
      description: 'Tide data spreadsheet'
    },
    {
      label: 'Western Roster',
      url: 'https://docs.google.com/spreadsheets/d/1gyhnteXo0hI4L7w-UHxkktNODI_k-WcXPGBbOgSTmo4/preview',
      description: 'Western Roster spreadsheet'
    }
  ];
}