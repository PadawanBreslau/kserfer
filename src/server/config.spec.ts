// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

describe('loadConfig', () => {
  it('falls back to the defaults when nothing is configured', () => {
    const config = loadConfig({});

    expect(config).toEqual({
      host: '0.0.0.0',
      maxUploadSizeBytes: 10 * 1024 * 1024,
      port: 7321,
    });
  });

  it('reads the values from the environment', () => {
    const config = loadConfig({ HOST: '127.0.0.1', PORT: '8080', MAX_UPLOAD_SIZE_BYTES: '2048' });

    expect(config).toEqual({ host: '127.0.0.1', maxUploadSizeBytes: 2048, port: 8080 });
  });

  it('trims the host and ignores blank values', () => {
    expect(loadConfig({ HOST: '  localhost  ' }).host).toBe('localhost');
    expect(loadConfig({ HOST: '   ' }).host).toBe('0.0.0.0');
    expect(loadConfig({ PORT: '   ' }).port).toBe(7321);
  });

  it('ignores values that are not positive numbers', () => {
    expect(loadConfig({ PORT: 'not-a-number' }).port).toBe(7321);
    expect(loadConfig({ PORT: '-1' }).port).toBe(7321);
    expect(loadConfig({ PORT: '0' }).port).toBe(7321);
    expect(loadConfig({ MAX_UPLOAD_SIZE_BYTES: 'NaN' }).maxUploadSizeBytes).toBe(10 * 1024 * 1024);
  });

  it('truncates fractional values', () => {
    expect(loadConfig({ PORT: '8080.9' }).port).toBe(8080);
  });
});
