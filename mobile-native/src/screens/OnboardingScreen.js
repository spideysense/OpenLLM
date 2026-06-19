// First-run, phone-first. One warm screen: download the on-device model once,
// then drop straight into local chat. No account, no box, no login.

import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { theme } from '../theme';
import { defaultModel } from '../engine/models';
import { isModelDownloaded, downloadModel } from '../engine/localEngine';

export default function OnboardingScreen({ onReady }) {
  const insets = useSafeAreaInsets();
  const model = defaultModel();
  const [progress, setProgress] = useState(null); // null=idle, 0..1=downloading
  const [error, setError] = useState('');

  const start = useCallback(async () => {
    setError('');
    try {
      if (await isModelDownloaded(model.file)) { onReady?.(model.id); return; }
      setProgress(0);
      await downloadModel(model.url, model.file, (p) => setProgress(p));
      try { await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } catch {}
      onReady?.(model.id);
    } catch (e) {
      setError(e?.message || 'Download failed. Check your connection and try again.');
      setProgress(null);
    }
  }, [model, onReady]);

  const sizeGB = (model.sizeBytes / 1e9).toFixed(1);
  const downloading = progress !== null;
  const pct = downloading ? Math.round(progress * 100) : 0;

  return (
    <View style={[styles.wrap, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]}>
      <View style={styles.center}>
        <Text style={styles.logo}>Aspen</Text>
        <Text style={styles.h1}>Private AI, right on your iPhone.</Text>
        <Text style={styles.sub}>Nothing leaves your device. Works offline. No account.</Text>
      </View>

      <View style={styles.bottom}>
        {downloading ? (
          <View style={styles.progressWrap}>
            <ActivityIndicator color={theme.text} />
            <Text style={styles.progressText}>Downloading {model.label} · {pct}%</Text>
            <Text style={styles.progressSub}>One time, ~{sizeGB} GB. Keep the app open.</Text>
          </View>
        ) : (
          <>
            <TouchableOpacity style={styles.cta} onPress={start} activeOpacity={0.85}>
              <Text style={styles.ctaText}>Download {model.label} · ~{sizeGB} GB</Text>
            </TouchableOpacity>
            <Text style={styles.fine}>Runs entirely on your iPhone. You can connect your Aspen on a Mac later for bigger models.</Text>
            {!!error && <Text style={styles.error}>{error}</Text>}
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg, paddingHorizontal: 28, justifyContent: 'space-between' },
  center: { flex: 1, justifyContent: 'center' },
  logo: { fontSize: 15, fontWeight: '700', color: theme.textMuted, letterSpacing: 1, marginBottom: 24 },
  h1: { fontSize: 30, fontWeight: '700', color: theme.text, lineHeight: 38 },
  sub: { fontSize: 16, color: theme.textMuted, marginTop: 12, lineHeight: 22 },
  bottom: {},
  cta: { backgroundColor: theme.accent, borderRadius: 16, paddingVertical: 17, alignItems: 'center' },
  ctaText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  fine: { fontSize: 13, color: theme.textMuted, textAlign: 'center', marginTop: 14, lineHeight: 18 },
  error: { fontSize: 13, color: theme.danger, textAlign: 'center', marginTop: 12 },
  progressWrap: { alignItems: 'center', paddingVertical: 8 },
  progressText: { fontSize: 16, fontWeight: '600', color: theme.text, marginTop: 14 },
  progressSub: { fontSize: 13, color: theme.textMuted, marginTop: 6 },
});
