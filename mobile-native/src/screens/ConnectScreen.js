import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '../theme';
import { fetchModels } from '../api';

export default function ConnectScreen({ onConnected, onCancel }) {
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function connect() {
    setError('');
    setBusy(true);
    try {
      const models = await fetchModels(url, key);
      onConnected({ tunnelUrl: url, apiKey: key }, models);
    } catch (e) {
      setError(
        "Couldn't reach your Aspen. Check the address, and make sure Aspen is running on your machine."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.brandRow}>
            <Text style={styles.brand}>ASPEN</Text>
            <View style={styles.beta}>
              <Text style={styles.betaText}>BETA</Text>
            </View>
          </View>

          <Text style={styles.title}>Connect to your machine</Text>
          <Text style={styles.subtitle}>
            Aspen runs privately on your own computer. Paste the address it shows, and this app
            talks straight to it.
          </Text>

          <Text style={styles.label}>Aspen address</Text>
          <TextInput
            style={styles.input}
            placeholder="https://xxxxxxxx.runonaspen.com"
            placeholderTextColor={theme.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            value={url}
            onChangeText={setUrl}
          />

          <Text style={styles.label}>API key (optional)</Text>
          <TextInput
            style={styles.input}
            placeholder="sk-aspen-…"
            placeholderTextColor={theme.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            value={key}
            onChangeText={setKey}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TouchableOpacity
            style={[styles.connect, (busy || !url.trim()) && styles.connectDisabled]}
            onPress={connect}
            disabled={busy || !url.trim()}
            activeOpacity={0.85}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.connectText}>Connect</Text>
            )}
          </TouchableOpacity>

          <Text style={styles.privacy}>
            🔒 Your messages go only to your machine. We never see them.
          </Text>

          {onCancel ? (
            <TouchableOpacity onPress={onCancel} style={styles.cancel} hitSlop={10}>
              <Text style={styles.cancelText}>Back to on-device</Text>
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg },
  scroll: { padding: 24, paddingTop: 40, flexGrow: 1 },
  brandRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 36 },
  brand: { fontSize: 18, fontWeight: '800', letterSpacing: 1, color: theme.text },
  beta: { marginLeft: 8, backgroundColor: theme.field, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  betaText: { fontSize: 9, fontWeight: '700', letterSpacing: 0.5, color: theme.textMuted },
  title: { fontSize: 26, fontWeight: '700', color: theme.text, marginBottom: 10 },
  subtitle: { fontSize: 15, lineHeight: 22, color: theme.textMuted, marginBottom: 28 },
  label: { fontSize: 13, fontWeight: '600', color: theme.textMuted, marginBottom: 6, marginTop: 6 },
  input: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 16,
    color: theme.text,
    marginBottom: 14,
    backgroundColor: theme.bg,
  },
  error: { color: theme.danger, fontSize: 14, marginBottom: 12, lineHeight: 20 },
  connect: {
    backgroundColor: theme.accent,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  connectDisabled: { opacity: 0.5 },
  connectText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  privacy: { fontSize: 13, color: theme.textMuted, textAlign: 'center', marginTop: 20 },
  cancel: { alignItems: 'center', marginTop: 18, paddingVertical: 8 },
  cancelText: { fontSize: 14, color: theme.textMuted, fontWeight: '500' },
});
