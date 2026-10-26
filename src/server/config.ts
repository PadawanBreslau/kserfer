const DEFAULT_PORT = 7321;
const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;

export interface ServerConfig {
  host: string;
  maxUploadSizeBytes: number;
  port: number;
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    host: env.HOST?.trim() || DEFAULT_HOST,
    maxUploadSizeBytes: readPositiveInteger(env.MAX_UPLOAD_SIZE_BYTES, DEFAULT_MAX_UPLOAD_SIZE_BYTES),
    port: readPositiveInteger(env.PORT, DEFAULT_PORT),
  };
}
