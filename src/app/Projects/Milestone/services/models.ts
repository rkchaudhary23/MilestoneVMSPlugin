/** Route segment and postMessage prefix for this integration (spec §4.3, §6.1). */
export const VENDOR_KEY = 'milestone';

/** Who is using the plugin, as handed over by Access360 (spec §4.3). */
export interface Access360Context {
  branchId: number;
  /** Empty when the context came from the DecodeData fallback, which carries no email. */
  email: string;
  via: 'handshake' | 'decode-data';
}

export type MilestoneLoginType = 'Basic' | 'Windows';

/** The tenant's real Milestone XProtect Mobile Server connection (spec §4.2, §6.3). */
export interface VmsConfiguration {
  /** Access360's id for the saved VMS record (AddModVMSDetails), 0 when not saved yet. */
  id: number;
  name: string;
  /** e.g. https://milestone.example.com:8082 */
  serverUrl: string;
  userName: string;
  password: string;
  loginType: MilestoneLoginType;
}

/** A camera as saved in Access360 by CamDetailsUpdate (spec §8.7–8.8). */
export interface SavedCamera {
  /** Access360's row id, used for update/delete. */
  id: number;
  /** Milestone camera GUID. This is the :cameraId Access360 passes to /live and /archive. */
  cameraId: string;
  name: string;
}

export interface CamDetails {
  adminId: number | null;
  vms: VmsConfiguration | null;
  cameras: SavedCamera[];
}

export const CAM_MODE = { insert: 0, update: 1, delete: 3 } as const;
