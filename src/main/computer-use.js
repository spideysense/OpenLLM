/**
 * Aspen Computer Use
 *
 * Lets the local AI see and control your screen to complete tasks autonomously.
 *
 * Input method (no native modules — works out of the box):
 *   - macOS:   osascript (System Events)
 *   - Windows: PowerShell (user32 / SendKeys)
 * Screenshots use Electron's desktopCapturer (main process only).
 *
 * robotjs was removed in the Electron 42 upgrade — it is abandoned and does not
 * build against modern Electron/Node ABIs. The OS-native paths below are the
 * single source of truth now.
 *
 * macOS requires Accessibility permission (System Settings → Privacy →
 * Accessibility → Aspen) and Screen Recording for screenshots. macOS prompts
 * automatically on first use.
 */

const { execSync, execFileSync } = require('child_process');
const os = require('os');

const isMac = os.platform() === 'darwin';
const isWin = os.platform() === 'win32';
const isLinux = os.platform() === 'linux';

// xdotool is the X11 input driver on Linux. Check once; give a clear, actionable
// error if it's missing instead of a cryptic ENOENT mid-task.
let _xdotoolChecked = false, _xdotoolOk = false;
function ensureXdotool() {
  if (!_xdotoolChecked) {
    _xdotoolChecked = true;
    try { execFileSync('xdotool', ['--version'], { timeout: 3000 }); _xdotoolOk = true; }
    catch { _xdotoolOk = false; }
  }
  if (!_xdotoolOk) throw new Error('xdotool is not installed. On the box run: sudo apt install -y xdotool');
}

// Lazy-load Electron APIs — only available inside the Electron main process,
// and only after the app is ready. Requiring at module load time can throw.
function getElectron() {
  return require('electron');
}

// robotjs has been removed. loadRobot() is kept as a no-op so existing call
// sites fall through to the OS-native input paths without a failed require or a
// confusing warning on every action.
function loadRobot() { return false; }

// ── Screenshot ──
async function screenshot() {
  const { desktopCapturer, screen } = getElectron();
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: Math.min(width, 1280), height: Math.min(height, 800) },
  });
  if (!sources.length) throw new Error('No screen sources found — check Screen Recording permission');
  const png = sources[0].thumbnail.toPNG();
  return `data:image/png;base64,${png.toString('base64')}`;
}

// ── Mouse control ──
function click(x, y, button = 'left', double = false) {
  x = Math.round(x); y = Math.round(y);
  const r = loadRobot();

  if (r) {
    // robotjs path
    r.moveMouse(x, y);
    if (double) {
      r.mouseClick(button, true);
    } else {
      r.mouseClick(button);
    }
    return;
  }

  // OS fallback
  if (isMac) {
    if (double) {
      execSync(`osascript -e 'tell application "System Events" to double click at {${x}, ${y}}'`);
    } else if (button === 'right') {
      execSync(`osascript -e 'tell application "System Events" to right click at {${x}, ${y}}'`);
    } else {
      execSync(`osascript -e 'tell application "System Events" to click at {${x}, ${y}}'`);
    }
  } else if (isWin) {
    execSync(`powershell -Command "
      Add-Type @'
      using System;using System.Runtime.InteropServices;
      public class Mouse {
        [DllImport(\\"user32.dll\\")]public static extern bool SetCursorPos(int x,int y);
        [DllImport(\\"user32.dll\\")]public static extern void mouse_event(int f,int x,int y,int d,int e);
      }
'@
      [Mouse]::SetCursorPos(${x},${y});
      [Mouse]::mouse_event(2,0,0,0,0);[Mouse]::mouse_event(4,0,0,0,0)
    "`);
  } else if (isLinux) {
    ensureXdotool();
    const btn = button === 'right' ? '3' : button === 'middle' ? '2' : '1';
    execFileSync('xdotool', ['mousemove', String(x), String(y)], { timeout: 5000 });
    if (double) execFileSync('xdotool', ['click', '--repeat', '2', btn], { timeout: 5000 });
    else execFileSync('xdotool', ['click', btn], { timeout: 5000 });
  }
}

function scroll(x, y, direction = 'down', amount = 3) {
  x = Math.round(x); y = Math.round(y);
  const r = loadRobot();

  if (r) {
    r.moveMouse(x, y);
    r.scrollMouse(0, direction === 'up' ? -amount : amount);
    return;
  }

  if (isMac) {
    const delta = direction === 'up' ? amount : -amount;
    // osascript scroll is unreliable — use Python as a more reliable fallback
    execSync(`python3 -c "
import Quartz
e=Quartz.CGEventCreateScrollWheelEvent(None,Quartz.kCGScrollEventUnitLine,1,${delta})
Quartz.CGEventPost(Quartz.kCGHIDEventTap,e)
" 2>/dev/null || osascript -e 'tell application "System Events" to scroll at {${x}, ${y}} by ${delta}'`);
  } else if (isLinux) {
    ensureXdotool();
    const btn = direction === 'up' ? '4' : '5';
    execFileSync('xdotool', ['mousemove', String(x), String(y)], { timeout: 5000 });
    execFileSync('xdotool', ['click', '--repeat', String(amount), btn], { timeout: 5000 });
  }
}

// ── Keyboard control ──
function typeText(text) {
  const r = loadRobot();

  if (r) {
    // robotjs handles unicode better — split on newlines
    const parts = text.split('\n');
    parts.forEach((part, i) => {
      if (part) r.typeString(part);
      if (i < parts.length - 1) r.keyTap('enter');
    });
    return;
  }

  if (isMac) {
    // Escape for AppleScript string
    const escaped = text
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"');
    execSync(`osascript -e 'tell application "System Events" to keystroke "${escaped}"'`);
  } else if (isWin) {
    execSync(`powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${text.replace(/'/g, "''")}')"`)
  } else if (isLinux) {
    ensureXdotool();
    // execFileSync passes text as a single arg — no shell escaping needed.
    execFileSync('xdotool', ['type', '--clearmodifiers', String(text)], { timeout: 15000 });
  }
}

function pressKey(combo) {
  const r = loadRobot();
  const parts = combo.toLowerCase().split('+');
  const key = parts[parts.length - 1];
  const modifiers = parts.slice(0, -1);

  if (r) {
    if (modifiers.length > 0) {
      r.keyTap(key, modifiers);
    } else {
      r.keyTap(key);
    }
    return;
  }

  if (isMac) {
    const MOD_MAP = { cmd: 'command', ctrl: 'control', alt: 'option', shift: 'shift', meta: 'command' };
    const KEY_MAP = {
      enter: 'return', esc: 'escape', backspace: 'delete',
      tab: 'tab', space: 'space', up: 'up arrow', down: 'down arrow',
      left: 'left arrow', right: 'right arrow', delete: 'forward delete',
    };
    const appleKey = KEY_MAP[key] || key;
    const appleMods = modifiers.map(m => MOD_MAP[m] || m);

    if (appleMods.length > 0) {
      const modStr = appleMods.map(m => `${m} down`).join(', ');
      // keystroke for printable chars, key code for special
      if (appleKey.length === 1) {
        execSync(`osascript -e 'tell application "System Events" to keystroke "${appleKey}" using {${modStr}}'`);
      } else {
        execSync(`osascript -e 'tell application "System Events" to key code (key code "${appleKey}") using {${modStr}}'`);
      }
    } else if (appleKey.length === 1) {
      execSync(`osascript -e 'tell application "System Events" to keystroke "${appleKey}"'`);
    } else {
      execSync(`osascript -e 'tell application "System Events" to key code "${appleKey}"'`);
    }
  } else if (isWin) {
    const WIN_MOD = { cmd: '^', ctrl: '^', alt: '%', shift: '+' };
    const mods = modifiers.map(m => WIN_MOD[m] || '').join('');
    execSync(`powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${mods}${key}')"`);
  } else if (isLinux) {
    ensureXdotool();
    const LIN_MOD = { cmd: 'super', meta: 'super', win: 'super', ctrl: 'ctrl', control: 'ctrl', alt: 'alt', option: 'alt', shift: 'shift' };
    const LIN_KEY = {
      enter: 'Return', esc: 'Escape', escape: 'Escape', backspace: 'BackSpace',
      tab: 'Tab', space: 'space', up: 'Up', down: 'Down', left: 'Left', right: 'Right',
      delete: 'Delete', pageup: 'Prior', pagedown: 'Next', home: 'Home', end: 'End',
    };
    const xmods = modifiers.map(m => LIN_MOD[m] || m);
    const xkey = LIN_KEY[key] || key;
    const spec = [...xmods, xkey].join('+');
    execFileSync('xdotool', ['key', '--clearmodifiers', spec], { timeout: 5000 });
  }
}

// ── Tool definitions ──
const COMPUTER_TOOLS = [
  {
    name: 'computer_screenshot',
    description: "Capture the current screen. ALWAYS call this before clicking or typing — you need to see what's on screen to know where to click.",
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'computer_click',
    description: 'Click at (x, y). Use computer_screenshot first to identify coordinates. x=0,y=0 is top-left.',
    input_schema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'Pixels from left edge' },
        y: { type: 'number', description: 'Pixels from top edge' },
        button: { type: 'string', enum: ['left', 'right'], description: 'Default: left' },
        double: { type: 'boolean', description: 'Double-click? Default: false' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'computer_type',
    description: 'Type text at the current cursor. Click a text field first with computer_click.',
    input_schema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'Text to type' } },
      required: ['text'],
    },
  },
  {
    name: 'computer_key',
    description: 'Press a key or combination. Examples: "enter", "escape", "tab", "cmd+c", "cmd+v", "cmd+a", "cmd+space", "ctrl+z".',
    input_schema: {
      type: 'object',
      properties: { combo: { type: 'string', description: 'Key combo' } },
      required: ['combo'],
    },
  },
  {
    name: 'computer_scroll',
    description: 'Scroll up or down at a screen position.',
    input_schema: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        direction: { type: 'string', enum: ['up', 'down'], description: 'Default: down' },
        amount: { type: 'number', description: 'Lines to scroll, default: 3' },
      },
      required: ['x', 'y'],
    },
  },
];

// ── Execute tool call ──
async function executeTool(name, args) {
  switch (name) {
    case 'computer_screenshot':
      return await screenshot();
    case 'computer_click':
      click(args.x, args.y, args.button || 'left', args.double || false);
      return `Clicked at (${Math.round(args.x)}, ${Math.round(args.y)})`;
    case 'computer_type':
      typeText(args.text);
      return `Typed: ${String(args.text).slice(0, 80)}${args.text.length > 80 ? '…' : ''}`;
    case 'computer_key':
      pressKey(args.combo);
      return `Pressed: ${args.combo}`;
    case 'computer_scroll':
      scroll(args.x, args.y, args.direction || 'down', args.amount || 3);
      return `Scrolled ${args.direction || 'down'} at (${Math.round(args.x)}, ${Math.round(args.y)})`;
    default:
      throw new Error(`Unknown computer tool: ${name}`);
  }
}

module.exports = { screenshot, click, typeText, pressKey, scroll, COMPUTER_TOOLS, executeTool, loadRobot };
