import { provideHttpClient } from '@angular/common/http';
import { APP_INITIALIZER, ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';

import { routes } from './app.routes';
import { RuntimeConfigService } from './Projects/Milestone/services/runtime-config.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(),
    {
      provide: APP_INITIALIZER,
      multi: true,
      deps: [RuntimeConfigService],
      useFactory: (config: RuntimeConfigService) => () => config.load(),
    },
  ],
};
