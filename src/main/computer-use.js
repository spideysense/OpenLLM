/**
 * Aspen Computer Use
 *
 * Lets the local AI see and control your screen to complete tasks autonomously.
 *
 * Input method priority:
 *   1. robotjs  — compiled native module, bundled in the DMG, fastest + most reliable
 *   2. osascript — macOS built-in, zero install, slightly slower (fallback)
 *   3. PowerShell — Windows built-in (fallback on Win)
 *
 * Screenshots always use Electron's desktopCapturer — no external deps.
 *
 * macOS requires Accessibility permission (System Preferences → Privacy →
 * Accessibility → Aspen). macOS prompts automatically on first use.
 */

const { execSync } = require('child_process');
const os = require('os');

const isMac = os.platform() === 'darwin';
const isWin = os.platform() === 'win32';

// Lazy-load Electron APIs — only available inside the Electron main process,
// and only after the app is ready. Requiring at module load time can throw.
function getElectron() {
  return require('electron');
}

// ── Load robotjs (bundled in DMG via asarUnpack) ──
let robot = null;
function loadRobot() {
  if (robot !== null) return robot;
  try {
    // In packaged app, native modules live in app.asar.unpacked
    robot = require('robotjs');
    console.log('[ComputerUse] robotjs loaded ✅');
  } catch (e) {
    console.warn('[ComputerUse] robotjs not available, using OS fallback:', e.message);
    robot = false; // false = tried and failed, don't retry
  }
  return robot;
}

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
