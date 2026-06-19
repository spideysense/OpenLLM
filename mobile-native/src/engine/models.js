// On-device model catalog. GGUF files run via llama.rn (llama.cpp + Metal).
//
// ⚠️ VERIFY THE URLs BELOW BEFORE SHIPPING. Open each in a browser — it must
// start downloading a .gguf directly. Hugging Face direct-download pattern is:
//   https://huggingface.co/<repo>/resolve/main/<file>.gguf?download=true
// Repos move/rename; confirm the exact repo + filename casing once on the Mac.
//
// Default = Llama 3.2 1B (small, fast, fits any modern iPhone at 4-bit).
// Optional = Qwen2.5 3B (smarter, gate behind device RAM ≥ 6 GB).

export const MODELS = {
  'llama-3.2-1b': {
    id: 'llama-3.2-1b',
    label: 'Llama 3.2 1B',
    file: 'llama-3.2-1b-instruct-q4_k_m.gguf',
    // VERIFY:
    url: 'https://huggingface.co/hugging-quants/Llama-3.2-1B-Instruct-Q4_K_M-GGUF/resolve/main/llama-3.2-1b-instruct-q4_k_m.gguf?download=true',
    sizeBytes: 808_000_000,        // ~0.8 GB, for the progress label
    minRamGB: 3,
    default: true,
  },
  'qwen2.5-3b': {
    id: 'qwen2.5-3b',
    label: 'Qwen2.5 3B',
    file: 'qwen2.5-3b-instruct-q4_k_m.gguf',
    // VERIFY:
    url: 'https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf?download=true',
    sizeBytes: 2_100_000_000,      // ~2 GB
    minRamGB: 6,
    default: false,
  },
};

export const DEFAULT_MODEL_ID = 'llama-3.2-1b';
export const defaultModel = () => MODELS[DEFAULT_MODEL_ID];
export const modelById = (id) => MODELS[id] || defaultModel();
