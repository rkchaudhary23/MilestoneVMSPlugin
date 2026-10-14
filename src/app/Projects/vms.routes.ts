import { Routes } from '@angular/router';

/**
 * Entry to add to the shared Projects/vms.routes.ts in IDCUBE's VMS workspace (spec §6.1).
 * This standalone project is served under /vms/milestone/ already, so app.routes.ts mounts
 * MILESTONE_ROUTES at the root instead of using this file.
 */
export const VMS_ROUTES: Routes = [
  {
    path: 'milestone',
    loadChildren: () => import('./Milestone/milestone.routes').then((m) => m.MILESTONE_ROUTES),
  },
];
