import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
const KEY = 'aspen.config.v1';
export async function loadConfig() {
  const saved = await SecureStore.getItemAsync(KEY);
  if (saved) return JSON.parse(saved);
  const legacy = await AsyncStorage.getItem(KEY);
  if (!legacy) return null;
  const value = JSON.parse(legacy);
  await saveConfig(value); await AsyncStorage.removeItem(KEY); return value;
}
export async function saveConfig(cfg) { await SecureStore.setItemAsync(KEY, JSON.stringify(cfg)); }
export async function clearConfig() { await SecureStore.deleteItemAsync(KEY); await AsyncStorage.removeItem(KEY); }
