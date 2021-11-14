export function exec(
  cmd: string,
  options?: {
    name?: string;
    icns?: string;
    env?: { [key: string]: string };
    pollDelay?: number;
  },
  done?: (
    error?: Error,
    stdout?: string | Buffer,
    stderr?: string | Buffer
  ) => void,
  afterPrompt?: (chunk?: any) => void
): void;
