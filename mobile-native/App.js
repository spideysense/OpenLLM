import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { loadConfig, saveConfig, clearConfig } from './src/storage';
import { fetchModels } from './src/api';
import ConnectScreen from './src/screens/ConnectScreen';
import ChatScreen from './src/screens/ChatScreen';
import { theme } from './src/theme';

export default function App() {
  const [ready, setReady] = useState(false);
  const [config, setConfig] = useState(null);
  const [model, setModel] = useState('');

  useEffect(() => {
    (async () => {
      const cfg = await loadConfig();
      if (cfg?.tunnelUrl) {
        setConfig(cfg);
        // Best-effort refresh of the active model for the footer; never blocks entry.
        try {
          const ms = await fetchModels(cfg.tunnelUrl, cfg.apiKey);
          if (ms?.length) setModel(ms[0]);
        } catch {}
      }
      setReady(true);
    })();
  }, []);

  async function handleConnected(cfg, models) {
    await saveConfig(cfg);
    setConfig(cfg);
    setModel(models?.[0] || '');
  }

  async function handleDisconnect() {
    await clearConfig();
    setConfig(null);
    setModel('');
  }

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.text} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {config ? (
        <ChatScreen config={config} model={model} onDisconnect={handleDisconnect} />
      ) : (
        <ConnectScreen onConnected={handleConnected} />
      )}
    </SafeAreaProvider>
  );
}
