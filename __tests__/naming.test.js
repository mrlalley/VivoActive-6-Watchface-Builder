const { safePrgName } = require('../lib/naming');

describe('safePrgName', () => {
  it('accepts clean names', () => {
    expect(safePrgName('MyWatchFace')).toBe('MyWatchFace');
    expect(safePrgName('Face2024')).toBe('Face2024');
  });

  it('replaces spaces with underscores', () => {
    expect(safePrgName('My Watch Face')).toBe('My_Watch_Face');
    expect(safePrgName('   spaced   name   ')).toBe('_spaced_name_');
  });

  it('removes invalid characters', () => {
    expect(safePrgName('Face@2024!')).toBe('Face2024');
    expect(safePrgName('My-Face#1')).toBe('My-Face1');
    expect(safePrgName('Face(v1.0)')).toBe('Facev10');
  });

  it('truncates to 30 characters', () => {
    const long = 'a'.repeat(31);
    const result = safePrgName(long);
    expect(result.length).toBe(30);
    expect(result).toBe('a'.repeat(30));
  });

  it('handles special character combinations', () => {
    expect(safePrgName('Face@#$%^&*()')).toBe('Face');
    expect(safePrgName('!!!My!!!Watch!!!')).toBe('MyWatch');
  });

  it('handles empty strings', () => {
    expect(safePrgName('')).toBe('WatchFace');
    expect(safePrgName('   ')).toBe('_');
  });

  it('handles null/undefined', () => {
    expect(safePrgName(null)).toBe('WatchFace');
    expect(safePrgName(undefined)).toBe('WatchFace');
  });

  it('preserves underscores and hyphens', () => {
    expect(safePrgName('my_face-v1')).toBe('my_face-v1');
  });

  it('filters out all non-alphanumeric except hyphen and underscore', () => {
    expect(safePrgName('face.v1_2-3')).toBe('facev1_2-3');
  });
});
