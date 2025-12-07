import { ApplicationConfig, provideZoneChangeDetection, LOCALE_ID } from '@angular/core';
import { provideRouter, withComponentInputBinding, withRouterConfig } from '@angular/router';
import { routes } from './app.routes';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideFirebaseApp, initializeApp } from '@angular/fire/app';
import { getAuth, provideAuth } from '@angular/fire/auth';
import { getFirestore, provideFirestore } from '@angular/fire/firestore';
import { getFunctions, provideFunctions } from '@angular/fire/functions';
import { environment } from '../environments/environment';
import { DatePipe, registerLocaleData } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { provideNativeDateAdapter } from '@angular/material/core';
import { MAT_DATE_LOCALE } from '@angular/material/core';
import localeEnGb from '@angular/common/locales/en-GB';

// Register European locale (Ireland/UK) for dd/MM/yy format
registerLocaleData(localeEnGb);

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes, withComponentInputBinding(), withRouterConfig({ onSameUrlNavigation: 'reload' })),
    provideAnimationsAsync(),
    // Add Firebase providers
    provideFirebaseApp(() => initializeApp(environment.firebase)),
    provideAuth(() => getAuth()),
    provideFirestore(() => getFirestore()),
    provideFunctions(() => getFunctions(undefined, 'europe-west1')),
    provideHttpClient(),
    provideNativeDateAdapter(),
    DatePipe,
    // Set European date format
    { provide: LOCALE_ID, useValue: 'en-GB' },
    { provide: MAT_DATE_LOCALE, useValue: 'en-GB' },
  ],
};
