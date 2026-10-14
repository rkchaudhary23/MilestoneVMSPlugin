import { CamDetails, MilestoneLoginType, SavedCamera, VmsConfiguration } from './models';

/*
 * The specification gives only partial response shapes for the Access360 WebServices
 * endpoints, so every response is read through these helpers: field names are matched
 * case-insensitively against the known aliases, and a { data: ... } wrapper or a
 * single-element array is unwrapped. When IDCUBE confirms the exact contracts, this is
 * the only file that needs to change.
 */

type Json = Record<string, unknown>;

export function unwrap(value: unknown): Json | null {
  let current = value;
  for (let i = 0; i < 3; i++) {
    if (Array.isArray(current)) {
      current = current[0];
      continue;
    }
    const data = isObject(current) ? field(current, 'data') : undefined;
    if (isObject(data) || Array.isArray(data)) {
      current = data;
      continue;
    }
    break;
  }
  return isObject(current) ? current : null;
}

export function field(obj: Json, ...names: string[]): unknown {
  const keys = Object.keys(obj);
  for (const name of names) {
    const key = keys.find((k) => k.toLowerCase() === name.toLowerCase());
    if (key !== undefined && obj[key] !== null && obj[key] !== undefined) {
      return obj[key];
    }
  }
  return undefined;
}

export function text(obj: Json, ...names: string[]): string {
  const value = field(obj, ...names);
  return value === undefined ? '' : String(value).trim();
}

export function int(obj: Json, ...names: string[]): number | null {
  const value = Number(field(obj, ...names));
  return Number.isInteger(value) ? value : null;
}

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Maps a saved VMS record. Returns null for the "all fields blank" first-time state (spec §8.3). */
export function toVmsConfiguration(raw: unknown): VmsConfiguration | null {
  const obj = unwrap(raw);
  if (!obj) {
    return null;
  }
  let serverUrl = text(obj, 'serviceURL', 'serverUrl', 'url', 'vmsUrl');
  if (!serverUrl) {
    const host = text(obj, 'hostIP', 'host');
    const port = text(obj, 'port');
    if (host) {
      serverUrl = /^https?:\/\//i.test(host) ? host : `https://${host}${port ? ':' + port : ''}`;
    }
  }
  const userName = text(obj, 'userName', 'username', 'user');
  if (!serverUrl && !userName) {
    return null;
  }
  const loginType: MilestoneLoginType =
    text(obj, 'loginType', 'authType').toLowerCase() === 'windows' ? 'Windows' : 'Basic';
  return {
    id: int(obj, 'id', 'vmsId') ?? 0,
    name: text(obj, 'name', 'vmsName') || 'Milestone XProtect',
    serverUrl,
    userName,
    password: text(obj, 'password', 'pwd'),
    loginType,
  };
}

export function toSavedCamera(raw: unknown): SavedCamera | null {
  if (!isObject(raw)) {
    return null;
  }
  const cameraId = text(raw, 'camId', 'cameraId', 'camGuid', 'cameraGuid', 'vmsCameraId');
  if (!cameraId) {
    return null;
  }
  return {
    id: int(raw, 'id', 'camAutoId', 'camDetailsId') ?? 0,
    cameraId,
    name: text(raw, 'camName', 'cameraName', 'name') || cameraId,
  };
}

export function toCamDetails(raw: unknown): CamDetails {
  if (Array.isArray(raw)) {
    raw = { cameras: raw };
  }
  const obj = unwrap(raw) ?? {};
  const list = field(obj, 'cameras', 'camDetails', 'camList', 'camera');
  const cameras = (Array.isArray(list) ? list : [])
    .map(toSavedCamera)
    .filter((c): c is SavedCamera => c !== null);
  const vmsRaw = field(obj, 'vms', 'vmsDetails', 'vmsDetail', 'server');
  return {
    adminId: int(obj, 'adminID', 'adminId'),
    vms: toVmsConfiguration(vmsRaw ?? obj),
    cameras,
  };
}

/** DecodeData returns the decoded keys BID, CID, EmpAutoId and TS (spec §8.5). */
export function toBranchId(raw: unknown): number | null {
  if (typeof raw === 'string') {
    try {
      return toBranchId(JSON.parse(raw));
    } catch {
      return null;
    }
  }
  const obj = unwrap(raw);
  if (!obj) {
    return null;
  }
  const branchId = int(obj, 'BID', 'branchId');
  return branchId !== null && branchId > 0 ? branchId : null;
}
