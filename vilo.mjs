#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { clearLine, createInterface, cursorTo } from 'node:readline';
import { linkScreen } from './screen.mjs';

const destination = join(homedir(), 'Downloads', 'Vilo');
const interactive = Boolean(process.stdout.isTTY);
const color = interactive && !('NO_COLOR' in process.env);
const accent = text => color ? '\x1b[38;2;194;220;235m' + text + '\x1b[0m' : text;
const muted = text => color ? '\x1b[90m' + text + '\x1b[0m' : text;
const help = 'Vilo | Загрузка видео\n\nvilo — вставить ссылки или текст\nvilo "https://..." — скачать по ссылке\n\nФайлы: ' + destination;

function linksIn(text) {
  const links = new Set();
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'«»\u0060]+/giu)) {
    let candidate = match[0].replace(/[.,!;:…]+$/u, '');
    for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']]) {
      while (candidate.endsWith(close) && candidate.split(close).length > candidate.split(open).length) {
        candidate = candidate.slice(0, -1);
      }
    }
    const url = URL.parse(candidate);
    if (url?.hostname) links.add(url.href);
  }
  return links;
}

async function readText() {
  if (process.stdin.isTTY && interactive) return linkScreen();
  if (process.stdin.isTTY) {
    console.log('\n  ' + accent('↓ Vilo') + '   Загрузка видео');
    console.log('  ' + muted('──────────────────────────────────'));
    console.log('  YouTube  ·  TikTok  ·  другие сайты\n');
    console.log('  Вставь ссылку или текст со ссылками');
    console.log('  ' + muted('[Enter] на пустой строке — скачать') + '\n');
    process.stdout.write('  ' + accent('›') + ' ');
  }
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const lines = [];
  for await (const line of input) {
    if (process.stdin.isTTY && !line.trim()) break;
    lines.push(line);
  }
  return lines.join('\n');
}

function download(url) {
  const args = [
    '--ignore-config', '--no-playlist', '--windows-filenames',
    '--js-runtimes', 'node:' + process.execPath,
    '-P', destination, '-o', '%(title).120B [%(id)s].%(ext)s',
    '--', url,
  ];
  if (interactive) {
    args.unshift('--quiet', '--progress', '--newline', '--encoding', 'utf-8',
      '--progress-template', 'download:vilo:%(progress._percent_str)s');
  }
  return new Promise((resolve, reject) => {
    const child = spawn('yt-dlp', args, {
      stdio: interactive ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'],
    });
    let diagnostics = '';
    if (interactive) {
      const output = createInterface({ input: child.stdout, crlfDelay: Infinity });
      output.on('line', line => {
        const match = /^vilo:\s*(\d+(?:\.\d+)?)%$/.exec(line.trimEnd());
        if (!match) return;
        const percent = Math.min(100, Number(match[1]));
        const filled = Math.floor(percent / 5);
        cursorTo(process.stdout, 0);
        clearLine(process.stdout, 0);
        process.stdout.write('      ' + accent('■'.repeat(filled)) +
          muted('·'.repeat(20 - filled)) + '  ' + percent.toFixed(0).padStart(3) + '%');
      });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', chunk => {
        diagnostics = (diagnostics + chunk).slice(-4000);
      });
    }
    child.once('error', reject);
    child.once('close', code => {
      if (interactive) {
        cursorTo(process.stdout, 0);
        clearLine(process.stdout, 0);
        console.log('      ' + (code === 0 ? accent('✓ Сохранено') : '× Ошибка загрузки'));
        if (code !== 0 && diagnostics.trim()) console.error(diagnostics.trimEnd());
      }
      resolve(code === 0);
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    console.log(help);
    return;
  }

  const input = args.length ? args.join(' ') : await readText();
  if (input === null) return;
  const urls = linksIn(input);
  if (!urls.size) {
    console.error('В тексте нет ссылок, начинающихся с https:// или http://.');
    process.exitCode = 1;
    return;
  }

  await mkdir(destination, { recursive: true });
  let done = 0;
  let current = 0;
  for (const url of urls) {
    current++;
    console.log(interactive
      ? '\n  ' + accent(String(current).padStart(2, '0') + '/' + String(urls.size).padStart(2, '0')) +
        '  ' + new URL(url).hostname
      : '\n[' + current + '/' + urls.size + '] ' + url);
    if (await download(url)) done++;
  }
  console.log('\n  ' + muted('──────────────────────────────────'));
  console.log('  Скачано  ' + accent(done + ' / ' + urls.size));
  console.log('  Папка    ' + destination + '\n');
  if (done !== urls.size) process.exitCode = 1;
}

main().catch(error => {
  console.error(error.code === 'ENOENT'
    ? 'Не найден yt-dlp. Установи: winget install --source winget --id yt-dlp.yt-dlp --exact. Затем открой CMD заново.'
    : error.message);
  process.exitCode = 1;
});
