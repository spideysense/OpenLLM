import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'aspen.config.v1';

export async function loadConfig() {
  try {
    const s = await AsyncStorage.getItem(KEY);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

export async function saveConfig(cfg) {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(cfg));
  } catch {}
}

export async function clearConfig() {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {}
}
