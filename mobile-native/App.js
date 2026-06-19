import React, { useEffect, useState, useCallback } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { loadConfig, saveConfig, clearConfig } from './src/storage';
import { loadAppState, saveAppState } from './src/appstate';
import { fetchModels } from './src/api';
import { isModelDownloaded } from './src/engine/localEngine';
import { modelById, defaultModel } from './src/engine/models';
import OnboardingScreen from './src/screens/OnboardingScreen';
import ChatScreen from './src/screens/ChatScreen';
import TierSheet from './src/screens/TierSheet';
import ConnectScreen from './src/screens/ConnectScreen';
import { theme } from './src/theme';

export default function App() {
  const [ready, setReady] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [mode, setMode] = useState('local');        // 'local' | 'box'
  const [localModelId, setLocalModelId] = useState(defaultModel().id);
  const [config, setConfig] = useState(null);       // box config
  const [boxModel, setBoxModel] = useState('');
  const [showTier, setShowTier] = useState(false);
  const [showConnect, setShowConnect] = useState(false);

  useEffect(() => {
    (async () => {
      const [cfg, st] = await Promise.all([loadConfig(), loadAppState()]);
      const wantModel = modelById(st.localModelId || defaultModel().id);
      const localReady = await isModelDownloaded(wantModel.file).catch(() => false);

      if (cfg?.tunnelUrl) {
        setConfig(cfg);
        try { const ms = await fetchModels(cfg.tunnelUrl, cfg.apiKey); if (ms?.length) setBoxModel(ms[0]); } catch {}
      }
      setLocalModelId(wantModel.id);

      // First run only if there's no local model AND no box to fall back to.
      setNeedsOnboarding(!localReady && !cfg?.tunnelUrl);
      // Default tier: last used, else local if downloaded, else box.
      setMode(st.lastTier || (localReady ? 'local' : (cfg?.tunnelUrl ? 'box' : 'local')));
      setReady(true);
    })();
  }, []);

  const onboarded = useCallback(async (modelId) => {
    setLocalModelId(modelId);
    setMode('local');
    setNeedsOnboarding(false);
    await saveAppState({ localModelId: modelId, lastTier: 'local' });
  }, []);

  const switchTier = useCallback(async (next) => {
    setMode(next);
    setShowTier(false);
    await saveAppState({ lastTier: next });
  }, []);

  const onConnected = useCallback(async (cfg, models) => {
    await saveConfig(cfg);
    setConfig(cfg);
    setBoxModel(models?.[0] || '');
    setShowConnect(false);
    await switchTier('box');
  }, [switchTier]);

  const onDisconnectBox = useCallback(async () => {
    await clearConfig();
    setConfig(null);
    setBoxModel('');
    await switchTier('local');
  }, [switchTier]);

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
      {needsOnboarding ? (
        <OnboardingScreen onReady={onboarded} />
      ) : showConnect ? (
        <ConnectScreen onConnected={onConnected} onCancel={() => setShowConnect(false)} />
      ) : (
        <ChatScreen
          mode={mode}
          config={config}
          boxModel={boxModel}
          localFile={modelById(localModelId).file}
          localLabel={modelById(localModelId).label}
          onOpenTier={() => setShowTier(true)}
        />
      )}
      <TierSheet
        visible={showTier}
        mode={mode}
        boxConnected={!!config}
        localLabel={modelById(localModelId).label}
        onClose={() => setShowTier(false)}
        onPickLocal={() => switchTier('local')}
        onPickBox={() => { config ? switchTier('box') : (setShowTier(false), setShowConnect(true)); }}
        onDisconnectBox={onDisconnectBox}
      />
    </SafeAreaProvider>
  );
}
