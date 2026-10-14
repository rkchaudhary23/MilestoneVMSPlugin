import { toBranchId, toCamDetails, toVmsConfiguration } from './response-mapping';

describe('response mapping', () => {
  it('treats an all-blank configuration as not configured', () => {
    expect(toVmsConfiguration({ serviceURL: '', userName: '', password: '' })).toBeNull();
    expect(toVmsConfiguration(null)).toBeNull();
  });

  it('maps a saved configuration, unwrapping data and matching names case-insensitively', () => {
    const config = toVmsConfiguration({ data: [{ Id: 4, ServiceURL: 'https://ms:8082', UserName: 'svc', Password: 'p' }] });
    expect(config).toEqual({
      id: 4,
      name: 'Milestone XProtect',
      serverUrl: 'https://ms:8082',
      userName: 'svc',
      password: 'p',
      loginType: 'Basic',
    });
  });

  it('builds the server URL from host and port when serviceURL is missing', () => {
    expect(toVmsConfiguration({ hostIP: 'ms.local', port: 8082, userName: 'u' })?.serverUrl).toBe('https://ms.local:8082');
  });

  it('maps camera details', () => {
    const details = toCamDetails({
      adminID: 7,
      vms: { id: 4, serviceURL: 'https://ms', userName: 'u' },
      cameras: [{ id: 1, camId: 'ABC', camName: 'Lobby' }, { id: 2 }],
    });
    expect(details.adminId).toBe(7);
    expect(details.vms?.id).toBe(4);
    expect(details.cameras).toEqual([{ id: 1, cameraId: 'ABC', name: 'Lobby' }]);
  });

  it('reads the branch from DecodeData output', () => {
    expect(toBranchId({ BID: '12', CID: 3 })).toBe(12);
    expect(toBranchId('{"BID":5}')).toBe(5);
    expect(toBranchId({ CID: 3 })).toBeNull();
  });
});
