/**
 * Cross-platform `npx` runner.
 *
 * On Windows `npx` is a `.cmd` shim. Since CVE-2024-27980, Node's native
 * spawn/execFile refuses to launch `.cmd`/`.bat` directly and raises
 * `spawn npx ENOENT`. cross-spawn resolves PATHEXT and the `.cmd` shim
 * transparently, without spawning a shell — no command injection surface.
 *
 * On failure it rejects with an error carrying `stdout`/`stderr`, mirroring
 * execFile so that errorDetail() can read the captured output unchanged.
 */
import spawn from 'cross-spawn';

export interface NpxOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  maxBuffer?: number;
  timeout?: number;
}

export interface NpxResult {
  stdout: string;
  stderr: string;
}

export function runNpx(args: string[], opts: NpxOptions): Promise<NpxResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let exceeded = false;
    let settled = false;

    const fail = (err: Error): void => {
      if (settled) { return; }
      settled = true;
      exceeded = true;
      try { child.kill(); } catch { /* already exited */ }
      reject(err);
    };

    const onChunk = (sink: 'stdout' | 'stderr', chunk: string): void => {
      if (opts.maxBuffer && (sink === 'stdout' ? stdout : stderr).length > opts.maxBuffer) {
        fail(new Error(`npx ${sink} exceeded maxBuffer (${opts.maxBuffer} bytes)`));
        return;
      }
      if (sink === 'stdout') { stdout += chunk; } else { stderr += chunk; }
    };

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => onChunk('stdout', chunk));
    child.stderr?.on('data', (chunk: string) => onChunk('stderr', chunk));

    const timer = opts.timeout
      ? setTimeout(() => fail(new Error(`npx timed out after ${opts.timeout}ms`)), opts.timeout)
      : undefined;

    child.on('error', err => {
      if (timer) { clearTimeout(timer); }
      fail(err);
    });
    child.on('close', code => {
      if (timer) { clearTimeout(timer); }
      if (settled) { return; }
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const err = new Error(`npx exited with code ${code}`) as Error & {
        code?: number | null;
        stdout?: string;
        stderr?: string;
      };
      err.code = code;
      err.stdout = stdout;
      err.stderr = stderr;
      reject(err);
    });
  });
}
