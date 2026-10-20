const { parentPort } = require('node:worker_threads');
const childProcess = require('node:child_process');

const children = new Map();
const post = message => parentPort.postMessage(message);
const serialize = error => ({ message: String(error && error.message || error), code: error && error.code, errno: error && error.errno, syscall: error && error.syscall, path: error && error.path, killed: error && error.killed, signal: error && error.signal });

function spawn({ id, command, args, options }) {
  let child;
  try {
    child = childProcess.spawn(command, args, options);
  } catch (error) {
    post({ type: 'error', id, error: serialize(error) });
    post({ type: 'close', id, code: null, signal: null });
    return;
  }
  children.set(id, child);
  child.once('spawn', () => post({ type: 'spawn', id, pid: child.pid }));
  child.stdout?.on('data', chunk => post({ type: 'stdout', id, data: String(chunk) }));
  child.stderr?.on('data', chunk => post({ type: 'stderr', id, data: String(chunk) }));
  child.stdin?.on('error', () => {});
  child.on('error', error => post({ type: 'error', id, error: serialize(error) }));
  child.on('close', (code, signal) => {
    children.delete(id);
    post({ type: 'close', id, code, signal });
  });
}

function execFile({ id, file, args, options }) {
  try {
    childProcess.execFile(file, args, options, (error, stdout, stderr) => {
      post({ type: 'exec', id, error: error ? serialize(error) : null, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
    });
  } catch (error) {
    post({ type: 'exec', id, error: serialize(error), stdout: '', stderr: '' });
  }
}

parentPort.on('message', message => {
  if (message.type === 'spawn') return spawn(message);
  if (message.type === 'exec') return execFile(message);
  const child = children.get(message.id);
  if (!child) return;
  try {
    if (message.type === 'kill') child.kill(message.signal);
    else if (message.type === 'stdin') child.stdin?.write(message.data);
    else if (message.type === 'stdin-end') child.stdin?.end();
  } catch {}
});
