import { execFile } from 'node:child_process';
import { emitKeypressEvents } from 'node:readline';
import { promisify } from 'node:util';

const clipboard = promisify(execFile);
const letters = [
  ['██    ██', '██    ██', ' ██  ██ ', '  ████  ', '   ▀▀   '],
  ['▄██▄', ' ▀▀ ', ' ██ ', ' ██ ', '▄██▄'],
  ['██    ', '██    ', '██    ', '██    ', '█████▄'],
  ['      ', '▄████▄', '██  ██', '██  ██', '▀████▀'],
];
const logoHeight = 7;

function rainbow(row, phase) {
  return row.replace(/[^ ]/g, (pixel, column) => {
    const angle = (column / row.length - phase) * 2 * Math.PI;
    const rgb = [0, 2, 4].map(offset =>
      Math.round(170 + 85 * Math.cos(angle - offset * Math.PI / 3)));
    return '\x1b[38;2;' + rgb.join(';') + 'm' + pixel;
  }) + '\x1b[0m';
}

export function linkScreen() {
  const input = process.stdin;
  const output = process.stdout;
  const color = !('NO_COLOR' in process.env);
  const style = (code, text) => color ? '\x1b[' + code + 'm' + text + '\x1b[0m' : text;
  const secondary = text => style('38;2;163;174;185', text);
  const edge = text => style('38;2;105;122;137', text);
  const started = performance.now();
  const topRow = () => Math.max(0, Math.floor(((output.rows || 24) - 17) / 2));
  const logoLines = () => {
    const columns = output.columns || 80;
    const time = (performance.now() - started) / 1000;
    const offsets = letters.map((_, index) =>
      color ? Math.round(1 + Math.sin(time * 3 - index * 0.9)) : 1);
    return Array.from({ length: logoHeight }, (_, y) => {
      const row = letters.map((letter, index) =>
        letter[y - offsets[index]] ?? ' '.repeat(letter[0].length)).join('  ');
      const visible = row.slice(0, columns - 1);
      const left = Math.max(0, Math.floor((columns - row.length) / 2));
      if (!color) return ' '.repeat(left) + visible;

      const waves = (start, end) => {
        let dots = '';
        for (let x = start; x < end; x++) {
          const wave = Math.sin(x * 0.16 + time * 1.4) + Math.sin(x * 0.08 - time);
          const distance = Math.abs(y - 3 - wave * 1.4);
          dots += distance < 0.4 ? '•' : distance < 1.1 ? '·' : ' ';
        }
        return style('38;2;55;83;103', dots);
      };
      const right = left + visible.length;
      return waves(0, Math.max(0, left - 3)) + ' '.repeat(Math.min(left, 3)) +
        rainbow(visible, time / 4) +
        ' '.repeat(Math.min(3, Math.max(0, columns - 1 - right))) +
        waves(right + 3, columns - 1);
    });
  };
  let value = '';
  let pasting = false;
  let readingClipboard = false;
  let hint = '';
  let active = true;

  function draw() {
    const columns = output.columns || 80;
    const width = Math.min(66, Math.max(1, columns - 2));
    const center = line => {
      const visible = line.slice(0, columns - 1);
      return ' '.repeat(Math.max(0, Math.floor((columns - visible.length) / 2))) + visible;
    };
    const button = ' ↓ Скачать ';
    const fieldWidth = Math.max(1, width - button.length - 6);
    const preview = value.replace(/\s/gu, ' ').replace(/[^\x20-\x7eА-Яа-яЁё]/gu, '?');
    const placeholder = 'https://youtube.com/watch?v=…';
    const visible = (preview || placeholder).slice(-fieldWidth).padEnd(fieldWidth);
    const left = ' '.repeat(Math.max(0, Math.floor((columns - width) / 2)));
    const top = topRow();
    const lines = [
      ...logoLines(), '',
      style(1, center('Загрузка видео')),
      secondary(center('YouTube · TikTok · Instagram · X')), '',
    ];
    let cursorColumn;
    let cursorRow;
    if (width >= 34) {
      const label = '─ Ссылка или текст ';
      cursorRow = top + lines.length + 2;
      cursorColumn = left.length + 5 + Math.min(preview.length, fieldWidth);
      lines.push(
        left + edge('╭') + secondary(label) + edge('─'.repeat(width - label.length - 2) + '╮'),
        left + edge('│ › ') + style(preview ? '48;2;29;35;43' : '48;2;29;35;43;38;2;163;174;185', visible) +
          ' ' + style('48;2;229;237;243;38;2;24;31;39', button) + edge('│'),
        left + edge('╰' + '─'.repeat(width - 2) + '╯'),
      );
    } else {
      cursorRow = top + lines.length + 1;
      cursorColumn = 3 + Math.min(preview.length, fieldWidth);
      lines.push('› ' + visible);
    }
    lines.push('', secondary(center(hint || (columns >= 55
      ? '[Ctrl+V] Вставить   [Enter] Скачать   [Esc] Выйти'
      : 'Ctrl+V · Enter · Esc'))));
    output.write('\x1b[H\x1b[2J' + '\n'.repeat(top) + lines.join('\n') +
      '\x1b[' + cursorRow + ';' + cursorColumn + 'H');
  }

  return new Promise(resolve => {
    const animation = color ? setInterval(() => {
      if ((output.rows || 24) < 17 || output.writableNeedDrain) return;
      const frame = logoLines().map((line, index) =>
        '\x1b[' + (topRow() + index + 1) + ';1H' + line).join('');
      output.write('\x1b[s' + frame + '\x1b[u');
    }, 60) : undefined;
    const wasRaw = Boolean(input.isRaw);
    let pendingDraw;
    function refresh() {
      pendingDraw ??= setImmediate(() => {
        pendingDraw = undefined;
        if (active) draw();
      });
    }
    function finish(result) {
      active = false;
      clearInterval(animation);
      input.off('keypress', onKey);
      input.off('end', onEnd);
      output.off('resize', draw);
      input.setRawMode(wasRaw);
      input.pause();
      output.write('\x1b[?2004l\x1b[2J\x1b[H');
      resolve(result);
    }

    function onEnd() {
      finish(null);
    }

    async function onKey(text, key) {
      if (key.name === 'paste-start') { pasting = true; return; }
      if (key.name === 'paste-end') { pasting = false; refresh(); return; }
      if (pasting) { value += text ?? ''; return; }
      if (key.name === 'escape' || (key.ctrl && key.name === 'c')) { finish(null); return; }
      if (readingClipboard) return;
      hint = '';
      if (key.name === 'return' || key.name === 'enter') {
        if (value.trim()) { finish(value); return; }
        hint = 'Сначала вставь ссылку';
      } else if (key.ctrl && key.name === 'v') {
        readingClipboard = true;
        try {
          const { stdout } = await clipboard('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-Command',
            '[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-Clipboard -Raw',
          ], { windowsHide: true, timeout: 3000 });
          value += stdout.trim();
        } catch {
          hint = 'Вставь текст через меню терминала';
        } finally {
          readingClipboard = false;
        }
      } else if (key.name === 'backspace') {
        value = Array.from(value).slice(0, -1).join('');
      } else if (text && !key.ctrl && !key.meta && !/[\x00-\x1f\x7f]/u.test(text)) {
        value += text;
      }
      if (active) refresh();
    }

    emitKeypressEvents(input);
    input.setRawMode(true);
    input.on('keypress', onKey);
    input.once('end', onEnd);
    output.on('resize', draw);
    output.write('\x1b[?2004h');
    draw();
    input.resume();
  });
}
