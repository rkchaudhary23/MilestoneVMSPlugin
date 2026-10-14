import { Routes } from '@angular/router';

export const MILESTONE_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./milestone/milestone.component').then((m) => m.MilestoneComponent),
    children: [
      { path: '', redirectTo: 'configuration', pathMatch: 'full' },
      {
        path: 'configuration',
        loadComponent: () =>
          import('./configuration/configuration.component').then((m) => m.ConfigurationComponent),
      },
      { path: 'live', loadComponent: () => import('./live/live-video.component').then((m) => m.LiveVideoComponent) },
      {
        path: 'live/:cameraId',
        loadComponent: () => import('./live/live-video.component').then((m) => m.LiveVideoComponent),
      },
      {
        path: 'archive',
        loadComponent: () => import('./archive/archive-video.component').then((m) => m.ArchiveVideoComponent),
      },
      {
        path: 'archive/:cameraId',
        loadComponent: () => import('./archive/archive-video.component').then((m) => m.ArchiveVideoComponent),
      },
    ],
  },
];
