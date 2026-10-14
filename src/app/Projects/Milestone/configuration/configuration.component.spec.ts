import { FormControl } from '@angular/forms';

import { diffCameras, serverUrlValidator } from './configuration.component';

describe('diffCameras', () => {
  it('marks new, renamed, unchanged and removed cameras', () => {
    const rows = diffCameras(
      [
        { cameraId: 'a', name: 'Lobby' },
        { cameraId: 'B', name: 'Gate 2' },
        { cameraId: 'c', name: 'Dock' },
      ],
      [
        { id: 1, cameraId: 'A', name: 'Lobby' },
        { id: 2, cameraId: 'b', name: 'Gate' },
        { id: 3, cameraId: 'd', name: 'Old' },
      ],
    );
    expect(rows.map((r) => [r.cameraId, r.status, r.savedId])).toEqual([
      ['a', 'unchanged', 1],
      ['B', 'renamed', 2],
      ['c', 'new', 0],
      ['d', 'removed', 3],
    ]);
  });
});

describe('serverUrlValidator', () => {
  const check = (value: string) => serverUrlValidator(new FormControl(value, { nonNullable: true }));

  it('accepts https URLs and rejects malformed ones', () => {
    expect(check('https://ms.example.com:8082')).toBeNull();
    expect(check('ms.example.com')).toEqual({ url: true });
    expect(check('ftp://ms.example.com')).toEqual({ url: true });
  });
});
