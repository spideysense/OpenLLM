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
  Share,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '../theme';
import { fetchModels, enroll, confirmEnrollment } from '../api';
import { saveConfig } from '../storage';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { parsePairing } from '../pairing.cjs';

export default function ConnectScreen({ onConnected, onCancel }) {
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [scan, setScan] = useState(false), [permission, askCamera] = useCameraPermissions();
  const [name, setName] = useState(''), [pending, setPending] = useState(null), [saved, setSaved] = useState(false);
  const isSetup = /^(setup|recovery)-aspen-/.test(key);

  async function connect() {
    setError('');
    setBusy(true);
    try {
      if (isSetup) {
        if (!pending) setPending(await enroll(url, key, { action: 'prepare', label: name }));
        else {
          const cfg = { tunnelUrl: url, apiKey: pending.credential };
          await saveConfig(cfg);
          await confirmEnrollment(url, key, pending);
          await onConnected(cfg, []);
        }
        return;
      }
      const models = await fetchModels(url, key);
      await onConnected({ tunnelUrl: url, apiKey: key }, models);
    } catch (e) {
      setError(
        e.message || "Couldn't reach your Aspen. Check that your phone and Aspen are on the same home network."
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
            Plug Aspen into your router and power. Scan its setup card to make it yours.
          </Text>
          <TouchableOpacity style={styles.connect} disabled={busy} onPress={async () => {
            const granted = permission?.granted || (await askCamera()).granted;
            if (granted) setScan(true); else setError('Camera access is needed to scan. You can enter the card details below.');
          }}><Text style={styles.connectText}>Scan Aspen code</Text></TouchableOpacity>
          {scan && <><CameraView style={{ height: 280, marginVertical: 16 }} barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={({ data }) => {
            setScan(false);
            try { const cfg = parsePairing(data); setUrl(cfg.tunnelUrl); setKey(cfg.apiKey); setPending(null); setSaved(false); setError(''); }
            catch (e) { setError(e.message); }
          }} /><TouchableOpacity onPress={() => setScan(false)}><Text>Cancel scan</Text></TouchableOpacity></>}

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
            editable={!pending}
          />

          <Text style={styles.label}>Pairing, setup, or recovery code</Text>
          <TextInput
            style={styles.input}
            placeholder="sk-aspen-…"
            placeholderTextColor={theme.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            value={key}
            onChangeText={setKey}
            editable={!pending}
          />
          {isSetup && !pending && <><Text style={styles.label}>Your name</Text><TextInput style={styles.input} value={name} onChangeText={setName} maxLength={100} /></>}
          {pending && <View>
            <Text style={styles.label}>Save your recovery code</Text>
            <Text>Anyone with this code can restore owner access. Keep it in your password manager or a safe place.</Text>
            <Text selectable style={styles.input}>{pending.recovery}</Text>
            <TouchableOpacity onPress={() => Share.share({ message: `Aspen recovery code: ${pending.recovery}\nKeep this private.` })}><Text>Save recovery code</Text></TouchableOpacity>
            <Text>I saved my recovery code</Text><Switch value={saved} onValueChange={setSaved} />
            <Text>Finishing setup replaces previous owner device credentials. Family members and their data stay in place.</Text>
            <TouchableOpacity onPress={() => { setPending(null); setSaved(false); }}><Text>Start again</Text></TouchableOpacity>
          </View>}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TouchableOpacity
            style={[styles.connect, (busy || !url.trim()) && styles.connectDisabled]}
            onPress={connect}
            disabled={busy || !url.trim() || !key.trim() || (isSetup && !name.trim()) || (!!pending && !saved)}
            activeOpacity={0.85}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.connectText}>{pending ? 'Finish setup' : isSetup ? 'Set up Aspen' : 'Connect'}</Text>
            )}
          </TouchableOpacity>

          <Text style={styles.privacy}>
            Your messages travel encrypted to your Aspen. Enabled outside tools have their own data-sharing settings.
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
