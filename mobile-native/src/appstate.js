// App-state prefs (tier + chosen on-device model), kept separate from the box
// config in storage.js so the two don't collide.

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'aspen.appstate.v1';

export async function loadAppState() {
  try {
    const s = await AsyncStorage.getItem(KEY);
    return s ? JSON.parse(s) : {};
  } catch {
    return {};
  }
}

export async function saveAppState(patch) {
  try {
    const cur = await loadAppState();
    await AsyncStorage.setItem(KEY, JSON.stringify({ ...cur, ...patch }));
  } catch {}
}
