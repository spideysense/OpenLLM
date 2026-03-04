const os = require('os');
const { execSync } = require('child_process');

let cachedInfo = null;

// ═══════════════════════════════════════════════════
// Detect system hardware
// ═══════════════════════════════════════════════════

function getSystemInfo() {
  if (cachedInfo) return cachedInfo;

  const totalRAM = os.totalmem();
  const totalRAMGB = Math.round(totalRAM / 1e9);
  const platform = process.platform;
  const arch = process.arch;
  const cpus = os.cpus();
  const cpuModel = cpus[0]?.model || 'Unknown CPU';
  const cpuCores = cpus.length;

  // Detect GPU
  let gpu = { type: 'cpu', name: 'CPU Only', vram: 0 };

  if (platform === 'darwin') {
    // Apple Silicon detection
    if (arch === 'arm64') {
      gpu = {
        type: 'metal',
        name: detectAppleSilicon(cpuModel),
        // Unified memory — shared with system RAM
        vram: totalRAMGB,
      };
    }
  } else if (platform === 'win32') {
    gpu = detectWindowsGPU();
  } else if (platform === 'linux') {
    gpu = detectLinuxGPU();
  }

  // Friendly machine name
  let machineName = 'Your Computer';
  if (platform === 'darwin') {
    if (arch === 'arm64') {
      machineName = `Mac (${gpu.name}, ${totalRAMGB}GB RAM)`;
    } else {
      machineName = `Mac (Intel, ${totalRAMGB}GB RAM)`;
    }
  } else if (platform === 'win32') {
    machineName = `Windows PC (${totalRAMGB}GB RAM${gpu.type !== 'cpu' ? ', ' + gpu.name : ''})`;
  } else {
    machineName = `Linux (${totalRAMGB}GB RAM)`;
  }

  cachedInfo = {
    platform,
    arch,
    totalRAMGB,
    cpu: cpuModel,
    cpuCores,
    gpu,
    machineName,
  };

  return cachedInfo;
}

function detectAppleSilicon(cpuModel) {
  try {
    const chip = execSync('sysctl -n machdep.cpu.brand_string', { encoding: 'utf8' }).trim();
    if (chip.includes('M4')) return 'Apple M4';
    if (chip.includes('M3')) return 'Apple M3';
    if (chip.includes('M2')) return 'Apple M2';
    if (chip.includes('M1')) return 'Apple M1';
    return chip;
  } catch {
    return 'Apple Silicon';
  }
}

function detectWindowsGPU() {
  try {
    const output = execSync(
      'wmic path win32_VideoController get name,adapterRAM /format:csv',
      { encoding: 'utf8' }
    );
    const lines = output.trim().split('\n').filter(l => l.includes(','));
    for (const line of lines) {
      const parts = line.split(',');
      const vram = parseInt(parts[1]) || 0;
      const name = parts[2]?.trim() || '';
      if (name.toLowerCase().includes('nvidia')) {
        return { type: 'cuda', name, vram: Math.round(vram / 1e9) };
      }
      if (name.toLowerCase().includes('amd') || name.toLowerCase().includes('radeon')) {
        return { type: 'rocm', name, vram: Math.round(vram / 1e9) };
      }
    }
  } catch { /* fall through */ }
  return { type: 'cpu', name: 'CPU Only', vram: 0 };
}

function detectLinuxGPU() {
  try {
    const output = execSync('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader', { encoding: 'utf8' });
    const parts = output.trim().split(',');
    const name = parts[0]?.trim();
    const vramMB = parseInt(parts[1]) || 0;
    return { type: 'cuda', name, vram: Math.round(vramMB / 1024) };
  } catch { /* no nvidia */ }
  return { type: 'cpu', name: 'CPU Only', vram: 0 };
}

// ═══════════════════════════════════════════════════
// Classify into hardware tier
// ═══════════════════════════════════════════════════

function getHardwareTier() {
  const info = getSystemInfo();
  const ram = info.totalRAMGB;
  const hasGPU = info.gpu.type !== 'cpu';
  const isAppleSilicon = info.gpu.type === 'metal';

  // Apple Silicon with unified memory is special — very efficient
  if (isAppleSilicon) {
    if (ram >= 64) return 'ultra';
    if (ram >= 32) return 'heavy';
    if (ram >= 16) return 'medium';
    return 'light';
  }

  // Discrete GPU systems
  if (hasGPU) {
    const vram = info.gpu.vram;
    if (vram >= 24 || ram >= 64) return 'ultra';
    if (vram >= 12 || ram >= 32) return 'heavy';
    if (vram >= 6 || ram >= 16) return 'medium';
    return 'light';
  }

  // CPU-only
  if (ram >= 64) return 'heavy';
  if (ram >= 16) return 'medium';
  return 'light';
}

module.exports = {
  getSystemInfo,
  getHardwareTier,
};
