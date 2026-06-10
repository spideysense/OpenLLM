/**
 * Aspen Computer Use — see and control the screen.
 *
 * Uses ONLY built-in OS capabilities — zero native modules, zero npm install.
 * Screenshots via Electron desktopCapturer.
 * Mouse/keyboard via osascript (macOS) or PowerShell (Windows).
 * macOS will prompt once for Accessibility permission — that's it.
 */

const { desktopCapturer, screen } = require('electron');
const { execSync } = require('child_process');
const os = require('os');

const isMac = os.platform() === 'darwin';
const isWin = os.platform() === 'win32';

// ── Screenshot ──
async function screenshot() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width, height },
  });
  if (!sources.length) throw new Error('No screen sources found');
  const png = sources[0].thumbnail.toPNG();
  return `data:image/png;base64,${png.toString('base64')}`;
}

// ── Mouse/keyboard via OS built-ins ──
function run(cmd) {
  execSync(cmd, { stdio: 'pipe', timeout: 5000 });
}

function click(x, y, button = 'left', double = false) {
  x = Math.round(x); y = Math.round(y);
  if (isMac) {
    const btn = button === 'right' ? 'right' : 'left';
    if (double) {
      run(`osascript -e 'tell application "System Events" to double click at {${x}, ${y}}'`);
    } else if (btn === 'right') {
      run(`osascript -e 'tell application "System Events" to right click at {${x}, ${y}}'`);
    } else {
      run(`osascript -e 'tell application "System Events" to click at {${x}, ${y}}'`);
    }
  } else if (isWin) {
    run(`powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x},${y}); Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class M{[DllImport(\\"user32.dll\\")]public static extern void mouse_event(int f,int x,int y,int d,int e);}'; [M]::mouse_event(2,0,0,0,0); [M]::mouse_event(4,0,0,0,0)"`);
  }
}

function typeText(text) {
  if (isMac) {
    // Escape for AppleScript
    const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    run(`osascript -e 'tell application "System Events" to keystroke "${escaped}"'`);
  } else if (isWin) {
    const escaped = text.replace(/"/g, '`"');
    run(`powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${escaped}')"`);
  }
}

function pressKey(combo) {
  if (isMac) {
    // Parse "cmd+c" → key "c" using {command down}
    const MAP = { cmd: 'command', ctrl: 'control', alt: 'option', shift: 'shift', meta: 'command' };
    const parts = combo.toLowerCase().split('+');
    const key = parts[parts.length - 1];
    const mods = parts.slice(0, -1).map(m => MAP[m] || m);

    // Special keys
    const SPECIAL = { enter: 'return', esc: 'escape', backspace: 'delete', tab: 'tab',
      space: 'space', up: 'up arrow', down: 'down arrow', left: 'left arrow', right: 'right arrow' };
    const appleKey = SPECIAL[key] || key;

    if (mods.length > 0) {
      const modStr = mods.map(m => `${m} down`).join(', ');
      run(`osascript -e 'tell application "System Events" to key code (key code of key "${appleKey}") using {${modStr}}'`);
      // Simpler form that works for most combos:
      run(`osascript -e 'tell application "System Events" to keystroke "${appleKey === key ? key : ''}" using {${modStr}}'`);
    } else {
      run(`osascript -e 'tell application "System Events" to key code (key code of key "${appleKey}")'`);
    }
  } else if (isWin) {
    const MAP = { cmd: '^', ctrl: '^', alt: '%', shift: '+' };
    const parts = combo.toLowerCase().split('+');
    const key = parts[parts.length - 1];
    const mods = parts.slice(0, -1).map(m => MAP[m] || '');
    run(`powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${mods.join('')}${key}')"`);
  }
}

function scroll(x, y, direction = 'down', amount = 3) {
  if (isMac) {
    const delta = direction === 'up' ? amount : -amount;
    run(`osascript -e 'tell application "System Events" to scroll at {${Math.round(x)}, ${Math.round(y)}} by ${delta}'`);
  }
}

// ── Tool definitions ──
const COMPUTER_TOOLS = [
  {
    name: 'computer_screenshot',
    description: 'Take a screenshot of the current screen. Always do this first before clicking or typing so you can see what\'s on screen.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'computer_click',
    description: 'Click at (x, y) on screen. Take a screenshot first to find the right coordinates.',
    input_schema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X coordinate' },
        y: { type: 'number', description: 'Y coordinate' },
        button: { type: 'string', enum: ['left', 'right'], description: 'Mouse button (default: left)' },
        double: { type: 'boolean', description: 'Double-click?' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'computer_type',
    description: 'Type text at the current cursor position. Click a text field first.',
    input_schema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'Text to type' } },
      required: ['text'],
    },
  },
  {
    name: 'computer_key',
    description: 'Press a key or combination: "enter", "escape", "tab", "cmd+c", "cmd+v", "cmd+space", "ctrl+a".',
    input_schema: {
      type: 'object',
      properties: { combo: { type: 'string', description: 'Key combo to press' } },
      required: ['combo'],
    },
  },
  {
    name: 'computer_scroll',
    description: 'Scroll at a position on screen.',
    input_schema: {
      type: 'object',
      properties: {
        x: { type: 'number' }, y: { type: 'number' },
        direction: { type: 'string', enum: ['up', 'down'] },
        amount: { type: 'number', description: 'How much to scroll (default: 3)' },
      },
      required: ['x', 'y'],
    },
  },
];

async function executeTool(name, args) {
  switch (name) {
    case 'computer_screenshot': return await screenshot();
    case 'computer_click': click(args.x, args.y, args.button, args.double); return `Clicked at (${args.x}, ${args.y})`;
    case 'computer_type': typeText(args.text); return `Typed: ${args.text.slice(0, 60)}`;
    case 'computer_key': pressKey(args.combo); return `Pressed: ${args.combo}`;
    case 'computer_scroll': scroll(args.x, args.y, args.direction, args.amount); return `Scrolled ${args.direction || 'down'}`;
    default: throw new Error(`Unknown computer tool: ${name}`);
  }
}

module.exports = { screenshot, click, typeText, pressKey, scroll, COMPUTER_TOOLS, executeTool };
