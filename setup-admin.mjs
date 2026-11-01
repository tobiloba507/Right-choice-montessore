import { randomBytes, scryptSync } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const envPath = resolve('.env');

if (existsSync(envPath)) {
  console.error('An .env file already exists. Remove it intentionally before running setup again.');
  process.exit(1);
}

const readline = createInterface({ input: stdin, output: stdout });

async function readPassword(prompt) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    throw new Error('Admin setup must be run in an interactive terminal so the password can be entered privately.');
  }

  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');

  return new Promise((resolvePassword, rejectPassword) => {
    let password = '';

    function finish(error) {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      stdout.write('\n');
      if (error) rejectPassword(error);
      else resolvePassword(password);
    }

    function onData(key) {
      if (key === '\u0003') {
        finish(new Error('Setup cancelled.'));
      } else if (key === '\r' || key === '\n') {
        finish();
      } else if (key === '\u007f' || key === '\b') {
        password = password.slice(0, -1);
        stdout.write('\b \b');
      } else if (key >= ' ' && key !== '\u007f') {
        password += key;
        stdout.write('*');
      }
    }

    stdin.on('data', onData);
  });
}

try {
  const username = (await readline.question('Admin username: ')).trim();
  readline.close();

  if (!/^[a-zA-Z0-9._-]{3,64}$/.test(username)) {
    throw new Error('Use 3–64 letters, numbers, dots, underscores, or hyphens for the username.');
  }

  const password = await readPassword('Admin password (at least 12 characters): ');
  const confirmation = await readPassword('Confirm admin password: ');

  if (password.length < 12) {
    throw new Error('The admin password must be at least 12 characters long.');
  }
  if (password !== confirmation) {
    throw new Error('The passwords did not match.');
  }

  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  const secret = randomBytes(48).toString('hex');
  const contents = [
    `ADMIN_USERNAME=${username}`,
    `ADMIN_PASSWORD_SALT=${salt}`,
    `ADMIN_PASSWORD_HASH=${hash}`,
    `SESSION_SECRET=${secret}`,
    'HOST=127.0.0.1',
    'PORT=3000',
    'NODE_ENV=development',
    '',
  ].join('\n');

  writeFileSync(envPath, contents, { flag: 'wx', mode: 0o600 });
  console.log('Admin credentials configured. The password is stored as a scrypt hash in the ignored .env file.');
  console.log('Start the site with: npm start');
} catch (error) {
  readline.close();
  console.error(error instanceof Error ? error.message : 'Admin setup failed.');
  process.exitCode = 1;
}
