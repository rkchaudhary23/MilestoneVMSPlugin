import { parseTime } from './archive-video.component';

describe('parseTime', () => {
  it('accepts ISO 8601 and epoch milliseconds', () => {
    expect(parseTime('2026-10-14T10:00:00Z')?.toISOString()).toBe('2026-10-14T10:00:00.000Z');
    expect(parseTime('1760436000000')?.getTime()).toBe(1760436000000);
  });

  it('rejects missing or invalid values', () => {
    expect(parseTime(null)).toBeNull();
    expect(parseTime('yesterday')).toBeNull();
  });
});
