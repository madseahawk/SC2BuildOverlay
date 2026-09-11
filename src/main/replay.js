'use strict';

/**
 * Reading build orders out of .SC2Replay files.
 *
 * The decoding is done by `tools/replay.py`, not here, and that is a deliberate
 * limit rather than laziness. A replay is an MPQ archive whose event streams are
 * bit-packed against a schema that changes with the game build; Blizzard's own
 * decoder, s2protocol, carries one generated schema per build. Re-implementing
 * that in Node means re-generating and then maintaining all of it, and getting
 * it subtly wrong means wrong times in someone's build order.
 *
 * So this module is the bridge: find a Python that can run the script, offer to
 * set one up if none can, and speak JSON to it. Everything the user sees comes
 * back through `state()`, so "why is this greyed out" always has an answer.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SETUP_TIMEOUT = 5 * 60 * 1000;
const RUN_TIMEOUT = 3 * 60 * 1000;

/**
 * Windows consoles hand a child cp949 by default, which mangles every Korean
 * name on the way back. UTF-8 is forced on both sides — `emit_json` writes
 * bytes, and this reads them as UTF-8.
 */
const CHILD_ENV = { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };

/**
 * @param {object} deps
 * @param {string} deps.resourcesDir   where `tools/` lives
 * @param {string} deps.venvDir        where a private Python may be created
 * @param {string} [deps.documentsDir] the real Documents folder, which is not
 *   always under the home directory — OneDrive redirects it, and Windows lets
 *   it be moved anywhere. Electron knows where it is; this module does not
 *   import Electron, so it is told.
 */
function createReplayTool({ resourcesDir, venvDir, documentsDir }) {
  const script = path.join(resourcesDir, 'tools', 'replay.py');
  const requirements = path.join(resourcesDir, 'tools', 'replay-requirements.txt');
  const venvPython = path.join(venvDir, 'Scripts', 'python.exe');

  let cached = null;   // last state(), so the UI does not re-probe on every keystroke
  let setupRunning = false;

  /** Candidate interpreters, ours first. */
  function candidates() {
    const found = [{ cmd: venvPython, args: [], ours: true }];
    if (process.platform === 'win32') {
      // The Windows launcher, which knows where Python actually is even when
      // `python` on PATH is the Store's stub that opens a shop page.
      found.push({ cmd: 'py', args: ['-3'], ours: false });
    }
    found.push({ cmd: 'python3', args: [], ours: false });
    found.push({ cmd: 'python', args: [], ours: false });
    return found;
  }

  function run(cmd, args, { timeout = RUN_TIMEOUT, cwd } = {}) {
    return new Promise((resolve) => {
      let child;
      try {
        child = spawn(cmd, args, {
          cwd: cwd || resourcesDir,
          env: { ...process.env, ...CHILD_ENV },
          windowsHide: true,
        });
      } catch (err) {
        resolve({ code: -1, out: '', err: String(err && err.message) });
        return;
      }

      const out = [];
      const errOut = [];
      let done = false;

      const timer = setTimeout(() => {
        if (!done) {
          child.kill();
          done = true;
          resolve({ code: -1, out: '', err: '시간이 너무 오래 걸려 중단했습니다.' });
        }
      }, timeout);

      child.stdout.on('data', (chunk) => out.push(chunk));
      child.stderr.on('data', (chunk) => errOut.push(chunk));
      child.on('error', (err) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ code: -1, out: '', err: String(err && err.message) });
      });
      child.on('close', (code) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({
          code,
          out: Buffer.concat(out).toString('utf8'),
          err: Buffer.concat(errOut).toString('utf8'),
        });
      });
    });
  }

  /**
   * Whether an interpreter exists and whether it can read a replay.
   *
   * Two questions, asked separately, because the answers need different
   * remedies: no usable Python means the user has to install one, while a
   * Python missing the two libraries is something this app can fix itself.
   *
   * The version check has to come first, and cannot be folded into the import
   * check. `py` and `python` are not always interpreters — Windows ships a
   * Store stub that opens a shop page, and Python's install manager puts down
   * commands that exist before any runtime does. Those all "run and fail", the
   * same as a real Python without the libraries, so a single check would offer
   * to install into something that cannot be installed into.
   */
  async function probe(python) {
    const alive = await run(python.cmd, [...python.args, '-c',
      'import sys; sys.stdout.write("py%d" % sys.version_info[0])'],
      { timeout: 30000 });
    if (!alive.out.includes('py3')) return 'missing';

    const got = await run(python.cmd, [...python.args, '-c',
      'import sys; import mpyq, s2protocol; sys.stdout.write("ok")'],
      { timeout: 30000 });
    return got.out.includes('ok') ? 'ready' : 'no-libs';
  }

  async function state({ refresh = false } = {}) {
    if (cached && !refresh) return cached;
    if (setupRunning) return { state: 'setting-up' };

    if (!fs.existsSync(script)) {
      cached = {
        state: 'no-script',
        message: '리플레이를 읽는 파일이 설치본에 없습니다: ' + script,
      };
      return cached;
    }

    let sawInterpreter = null;
    for (const python of candidates()) {
      if (python.ours && !fs.existsSync(python.cmd)) continue;
      const result = await probe(python);
      if (result === 'ready') {
        cached = { state: 'ready', python, ours: python.ours };
        return cached;
      }
      if (result === 'no-libs' && !sawInterpreter) sawInterpreter = python;
    }

    cached = sawInterpreter
      ? {
          state: 'needs-setup',
          python: sawInterpreter,
          message: '파이썬이 설치돼 있습니다. 아래 버튼을 누르면 리플레이를 읽을 '
            + '준비를 마칩니다 (한 번만, 약 3MB).',
        }
      : {
          state: 'no-python',
          // Not "restart the app": the probe re-runs on demand, so installing
          // Python in another window and pressing 다시 확인 is enough.
          message: '리플레이를 읽으려면 파이썬이 필요합니다. 아래에서 받아 설치한 뒤 '
            + '다시 확인을 누르세요.',
        };
    return cached;
  }

  /**
   * Creates a private virtual environment and installs the two libraries into
   * it.
   *
   * Private on purpose: installing into whatever Python happens to be on PATH
   * changes something the user did not ask this app to change, and this app has
   * no business doing that. The venv lives beside the app's own data and can be
   * deleted without trace.
   *
   * @param {(line: string) => void} onLine  progress, for the UI
   */
  async function setup(onLine = () => {}) {
    if (setupRunning) return { ok: false, message: '이미 준비 중입니다.' };

    const current = await state({ refresh: true });
    if (current.state === 'ready') return { ok: true, already: true };
    if (current.state === 'no-python') return { ok: false, message: current.message };
    if (current.state === 'no-script') return { ok: false, message: current.message };

    setupRunning = true;
    cached = null;
    try {
      const base = current.python;

      if (!fs.existsSync(venvPython)) {
        onLine('전용 파이썬 환경을 만듭니다…');
        const made = await run(base.cmd, [...base.args, '-m', 'venv', venvDir],
          { timeout: SETUP_TIMEOUT });
        if (!fs.existsSync(venvPython)) {
          return {
            ok: false,
            message: '환경을 만들지 못했습니다.\n' + (made.err || made.out).trim(),
          };
        }
      }

      onLine('필요한 파일을 받습니다…');
      const args = ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-input'];
      const installed = await run(venvPython,
        fs.existsSync(requirements)
          ? [...args, '-r', requirements]
          : [...args, 'mpyq', 's2protocol'],
        { timeout: SETUP_TIMEOUT });

      if (await probe({ cmd: venvPython, args: [] }) !== 'ready') {
        return {
          ok: false,
          message: '받는 데 실패했습니다. 인터넷 연결을 확인해 주세요.\n'
            + (installed.err || installed.out).trim().slice(-600),
        };
      }
      onLine('준비됐습니다.');
      return { ok: true };
    } finally {
      setupRunning = false;
      cached = null;
    }
  }

  /** Runs the script in its JSON mode. */
  async function call(args) {
    const current = await state();
    if (current.state !== 'ready') {
      return { ok: false, needsSetup: true, ...current };
    }
    const python = current.python;
    const got = await run(python.cmd,
      [...python.args, script, ...args, '--json', '--repo', resourcesDir]);

    if (!got.out.trim()) {
      return {
        ok: false,
        message: (got.err || '').trim()
          || '리플레이를 읽지 못했습니다 (스크립트가 아무 답도 하지 않았습니다).',
      };
    }
    try {
      return JSON.parse(got.out);
    } catch (err) {
      return {
        ok: false,
        message: '결과를 이해하지 못했습니다: ' + got.out.trim().slice(0, 300),
      };
    }
  }

  /** Who is in these replays, so the user can pick a side. */
  function list(files) {
    if (!files || !files.length) return Promise.resolve({ ok: false, message: '리플레이를 고르세요.' });
    return call([...files, '--list']);
  }

  /**
   * @param {string} file
   * @param {object} opts
   * @param {number|string} [opts.player]   id or name fragment; the human by default
   * @param {number} [opts.minutes]         keep only the first N minutes
   */
  /**
   * @param {object} opts
   * @param {number|string} [opts.player]  id or name fragment; the human by default
   * @param {number} [opts.minutes]        keep only the first N minutes
   * @param {string[]} [opts.extras]       'chrono' | 'mule' | 'swap'
   */
  function convert(file, { player, minutes, extras } = {}) {
    const args = [file];
    if (player != null && player !== '') args.push('--player', String(player));
    if (minutes) args.push('--minutes', String(minutes));
    // Named one by one rather than passed as a list, so an unknown name is
    // rejected by the script's own argument parsing instead of ignored.
    for (const name of ['chrono', 'mule', 'swap']) {
      if (extras && extras.includes(name)) args.push('--' + name);
    }
    return call(args);
  }

  /**
   * Where SC2 keeps replays, for the file dialog to open somewhere useful.
   *
   * The real ones sit under Accounts/<id>/<id>/Replays/Multiplayer, which is
   * nowhere anyone wants to navigate to by hand. Deepest existing folder wins;
   * if nothing matches, the dialog just opens wherever it likes.
   */
  function defaultDir() {
    const bases = [documentsDir, path.join(os.homedir(), 'Documents'),
      path.join(os.homedir(), 'OneDrive', 'Documents')].filter(Boolean);

    const root = bases
      .map((base) => path.join(base, 'StarCraft II'))
      .find((dir) => fs.existsSync(dir));
    if (!root) return null;

    const accounts = path.join(root, 'Accounts');
    try {
      for (const account of fs.readdirSync(accounts)) {
        for (const handle of fs.readdirSync(path.join(accounts, account))) {
          const multi = path.join(accounts, account, handle, 'Replays', 'Multiplayer');
          if (fs.existsSync(multi)) return multi;
        }
      }
    } catch (err) {
      /* Any of those folders may be absent; the root is still a better start. */
    }
    const replays = path.join(root, 'Replays');
    return fs.existsSync(replays) ? replays : root;
  }

  return { state, setup, list, convert, defaultDir, venvDir };
}

module.exports = { createReplayTool };
