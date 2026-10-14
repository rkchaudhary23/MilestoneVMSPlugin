import { Routes } from '@angular/router';

/*
 * The image is built with --base-href /vms/milestone/, so the plugin's own routes sit at
 * the root here: /vms/milestone/configuration, /vms/milestone/live/:cameraId and
 * /vms/milestone/archive/:cameraId (spec §4.3).
 */
export const routes: Routes = [
  {
    path: '',
    loadChildren: () => import('./Projects/Milestone/milestone.routes').then((m) => m.MILESTONE_ROUTES),
  },
  { path: '**', redirectTo: '' },
];
