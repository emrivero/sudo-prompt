export function exec(
  cmd: string,
  options?:
    | ((
        error?: Error,
        stdout?: string | Buffer,
        stderr?: string | Buffer
      ) => void)
    | { name?: string; icns?: string; env?: { [key: string]: string } },
  done?: (
    error?: Error,
    stdout?: string | Buffer,
    stderr?: string | Buffer
  ) => void,
  afterPrompt?: (chunk?: any) => void
): void;
