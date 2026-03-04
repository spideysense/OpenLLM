import '@testing-library/jest-dom';

// ═══════════════════════════════════════════════════
// Mock window.llmbear (Electron preload bridge)
// ═══════════════════════════════════════════════════

const mockBridge = {
  system: {
    getInfo: vi.fn().mockResolvedValue({
      platform: 'darwin',
      arch: 'arm64',
      totalRAMGB: 16,
      cpu: 'Apple M2',
      cpuCores: 8,
      gpu: { type: 'metal', name: 'Apple M2', vram: 16 },
      machineName: 'Mac (Apple M2, 16GB RAM)',
    }),
    getHardwareTier: vi.fn().mockResolvedValue('medium'),
  },
  ollama: {
    status: vi.fn().mockResolvedValue({ installed: true, running: true, host: 'http://127.0.0.1:11434' }),
    ensureRunning: vi.fn().mockResolvedValue({ success: true, alreadyRunning: true }),
    isInstalled: vi.fn().mockResolvedValue(true),
    install: vi.fn().mockResolvedValue({ success: true }),
  },
  models: {
    list: vi.fn().mockResolvedValue([
      { name: 'qwen2.5:7b', size: 4700000000, sizeGB: '4.7', family: 'qwen2', parameterSize: '7B', quantization: 'Q4_K_M' },
      { name: 'llama3.2:3b', size: 2000000000, sizeGB: '2.0', family: 'llama', parameterSize: '3B', quantization: 'Q4_K_M' },
    ]),
    pull: vi.fn().mockResolvedValue({ success: true }),
    delete: vi.fn().mockResolvedValue({ success: true }),
    getRunning: vi.fn().mockResolvedValue([]),
    recommend: vi.fn().mockResolvedValue({ model: 'qwen2.5:7b', name: 'Qwen 2.5 7B', why: 'Best for your hardware', sizeGB: '4.7' }),
    onPullProgress: vi.fn().mockReturnValue(() => {}),
  },
  chat: {
    send: vi.fn().mockResolvedValue({ success: true, response: 'Hello!' }),
    stop: vi.fn().mockResolvedValue({ success: true }),
    onStream: vi.fn().mockReturnValue(() => {}),
  },
  gateway: {
    status: vi.fn().mockResolvedValue({ running: true, port: 4000, url: 'http://localhost:4000/v1' }),
    getPort: vi.fn().mockResolvedValue(4000),
  },
  apikeys: {
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ id: 'test-id', label: 'Test', secret: 'sk-llmbear-test123', created: new Date().toISOString() }),
    revoke: vi.fn().mockResolvedValue({ success: true }),
  },
  aliases: {
    list: vi.fn().mockResolvedValue({ 'gpt-4': 'qwen2.5:32b', 'gpt-4o': 'qwen2.5:7b' }),
    set: vi.fn().mockResolvedValue({ success: true }),
    getDefaults: vi.fn().mockResolvedValue({ 'gpt-4': 'qwen2.5:32b', 'gpt-4o': 'qwen2.5:7b', 'claude-3.5-sonnet': 'qwen2.5:7b' }),
  },
  registry: {
    get: vi.fn().mockResolvedValue({ schema_version: 2, categories: {} }),
    checkUpgrades: vi.fn().mockResolvedValue([]),
  },
  store: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(null),
  },
  app: {
    openExternal: vi.fn(),
    getVersion: vi.fn().mockResolvedValue('0.1.0'),
  },
};

// Attach to window
Object.defineProperty(window, 'llmbear', { value: mockBridge, writable: true });

// Export for tests to access
export { mockBridge };
