/**
 * Aspen Computer Use — lets the local AI see and control the screen.
 *
 * Architecture:
 *   1. screenshot()  — captures the full screen as a base64 PNG
 *   2. click(x, y)   — moves mouse and clicks at coordinates
 *   3. type(text)    — types text via keyboard
 *   4. key(combo)    — presses a key combination (e.g. "cmd+c")
 *   5. scroll(x, y, direction, amount) — scrolls at position
 *   6. runComputerLoop(goal, model) — the agent loop:
 *        screenshot → send to model with goal → model decides action
 *        → execute action → screenshot again → repeat until done
 *
 * Uses Electron's desktopCapturer for screenshots and robotjs for
 * mouse/keyboard. robotjs is a native module — requires rebuild for
 * the current Electron version.
 *
 * Tool schema (registers with tools.js):
 *   computer_screenshot  — take a screenshot, returns base64 PNG
 *   computer_click       — click at x,y
 *   computer_type        — type text
 *   computer_key         — press key combo
 *   computer_scroll      — scroll at position
 */

const { desktopCapturer, screen, nativeImage } = require('electron');
const path = require('path');

// ── robotjs for mouse/keyboard control ──
// Optional — gracefully degrade if not installed
let robot = null;
try {
  robot = require('robotjs');
} catch {
  console.warn('[ComputerUse] robotjs not available — install with: npm install robotjs');
}

// ── Screenshot via Electron desktopCapturer ──
async function screenshot() {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 1280, height: 800 },
  });

  if (!sources.length) throw new Error('No screen sources found');

  const source = sources[0];
  const image = source.thumbnail;
  const png = image.toPNG();
  return `data:image/png;base64,${png.toString('base64')}`;
}

// ── Mouse control ──
function click(x, y, button = 'left', double = false) {
  if (!robot) throw new Error('robotjs not installed — run: npm install robotjs');
  robot.moveMouse(Math.round(x), Math.round(y));
  if (double) {
    robot.mouseClick(button, true);
  } else {
    robot.mouseClick(button);
  }
}

function rightClick(x, y) {
  if (!robot) throw new Error('robotjs not installed');
  robot.moveMouse(Math.round(x), Math.round(y));
  robot.mouseClick('right');
}

function scroll(x, y, direction = 'down', amount = 3) {
  if (!robot) throw new Error('robotjs not installed');
  robot.moveMouse(Math.round(x), Math.round(y));
  const d = direction === 'up' ? -amount : amount;
  robot.scrollMouse(0, d);
}

// ── Keyboard control ──
function typeText(text) {
  if (!robot) throw new Error('robotjs not installed');
  // robotjs typeString is fast but doesn't handle special chars well
  // Split on newlines and handle Enter separately
  const parts = text.split('\n');
  parts.forEach((part, i) => {
    if (part) robot.typeString(part);
    if (i < parts.length - 1) robot.keyTap('enter');
  });
}

function pressKey(combo) {
  if (!robot) throw new Error('robotjs not installed');
  // combo like "cmd+c", "ctrl+a", "enter", "escape", "tab"
  const parts = combo.toLowerCase().split('+');
  const key = parts[parts.length - 1];
  const modifiers = parts.slice(0, -1);
  if (modifiers.length > 0) {
    robot.keyTap(key, modifiers);
  } else {
    robot.keyTap(key);
  }
}

// ── Screen info ──
function getScreenSize() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  return { width, height };
}

// ── Tool definitions for agent.js ──
const COMPUTER_TOOLS = [
  {
    name: 'computer_screenshot',
    description: 'Take a screenshot of the current screen. Returns a base64 PNG image. Always take a screenshot before deciding what to click or type.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'computer_click',
    description: 'Click at a specific (x, y) coordinate on the screen. Use computer_screenshot first to see what\'s on screen and identify coordinates.',
    input_schema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X coordinate (pixels from left)' },
        y: { type: 'number', description: 'Y coordinate (pixels from top)' },
        button: { type: 'string', enum: ['left', 'right'], description: 'Mouse button (default: left)' },
        double: { type: 'boolean', description: 'Double-click (default: false)' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'computer_type',
    description: 'Type text at the current cursor position. Click on a text field first using computer_click.',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to type' },
      },
      required: ['text'],
    },
  },
  {
    name: 'computer_key',
    description: 'Press a keyboard key or combination. Examples: "enter", "escape", "tab", "cmd+c", "cmd+v", "ctrl+a", "cmd+space".',
    input_schema: {
      type: 'object',
      properties: {
        combo: { type: 'string', description: 'Key or combo to press (e.g. "enter", "cmd+c", "ctrl+z")' },
      },
      required: ['combo'],
    },
  },
  {
    name: 'computer_scroll',
    description: 'Scroll at a specific position on screen.',
    input_schema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X coordinate to scroll at' },
        y: { type: 'number', description: 'Y coordinate to scroll at' },
        direction: { type: 'string', enum: ['up', 'down'], description: 'Scroll direction' },
        amount: { type: 'number', description: 'Scroll amount (default: 3)' },
      },
      required: ['x', 'y'],
    },
  },
];

// ── Execute a computer tool call ──
async function executeTool(toolName, args) {
  switch (toolName) {
    case 'computer_screenshot':
      return await screenshot();
    case 'computer_click':
      click(args.x, args.y, args.button || 'left', args.double || false);
      return `Clicked at (${args.x}, ${args.y})`;
    case 'computer_type':
      typeText(args.text);
      return `Typed: ${args.text.slice(0, 50)}${args.text.length > 50 ? '...' : ''}`;
    case 'computer_key':
      pressKey(args.combo);
      return `Pressed: ${args.combo}`;
    case 'computer_scroll':
      scroll(args.x, args.y, args.direction || 'down', args.amount || 3);
      return `Scrolled ${args.direction || 'down'} at (${args.x}, ${args.y})`;
    default:
      throw new Error(`Unknown computer tool: ${toolName}`);
  }
}

module.exports = {
  screenshot,
  click,
  rightClick,
  scroll,
  typeText,
  pressKey,
  getScreenSize,
  COMPUTER_TOOLS,
  executeTool,
};
