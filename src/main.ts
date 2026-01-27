import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app';
import { environment } from './environments/environment';

// Set environment-specific favicon before bootstrapping
// This allows us to visually distinguish localhost from production
if (environment.favicon) {
  const link: HTMLLinkElement = document.querySelector("link[rel*='icon']") || document.createElement('link');
  link.type = 'image/png';
  link.rel = 'icon';
  link.href = environment.favicon;
  document.head.appendChild(link);
}

bootstrapApplication(AppComponent, appConfig)
  .catch((err) => console.error(err));
