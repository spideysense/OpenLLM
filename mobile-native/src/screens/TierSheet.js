// Tier sheet — pick where the AI runs. Reached from the header pill.
//   On iPhone  : the on-device model (instant, private, offline)
//   On your Aspen: connect to your Mac/box for the big models

import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../theme';

export default function TierSheet({
  visible, mode, boxConnected, localLabel,
  onClose, onPickLocal, onPickBox, onDisconnectBox,
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.grabber} />
        <Text style={styles.title}>Where should Aspen run?</Text>

        <Row
          active={mode === 'local'}
          title="On iPhone"
          sub={`${localLabel} · instant, private, works offline`}
          onPress={onPickLocal}
        />
        <Row
          active={mode === 'box'}
          title="On your Aspen"
          sub={boxConnected ? 'Connected · the big models' : 'Connect your Mac or Aspen box for bigger models'}
          onPress={onPickBox}
        />

        {boxConnected && (
          <TouchableOpacity onPress={onDisconnectBox} style={styles.disconnect}>
            <Text style={styles.disconnectText}>Disconnect Aspen</Text>
          </TouchableOpacity>
        )}
      </View>
    </Modal>
  );
}

function Row({ active, title, sub, onPress }) {
  return (
    <TouchableOpacity style={[styles.row, active && styles.rowActive]} onPress={onPress} activeOpacity={0.8}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSub}>{sub}</Text>
      </View>
      {active && <Text style={styles.check}>✓</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: theme.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22,
    paddingHorizontal: 18, paddingTop: 10,
  },
  grabber: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, backgroundColor: 'rgba(0,0,0,0.15)', marginBottom: 14 },
  title: { fontSize: 17, fontWeight: '700', color: theme.text, marginBottom: 14, paddingHorizontal: 4 },
  row: { flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 14, borderWidth: 1, borderColor: theme.border, marginBottom: 10 },
  rowActive: { borderColor: theme.accent, backgroundColor: '#FAFAFA' },
  rowTitle: { fontSize: 16, fontWeight: '600', color: theme.text },
  rowSub: { fontSize: 13, color: theme.textMuted, marginTop: 3 },
  check: { fontSize: 18, color: theme.accent, fontWeight: '700', marginLeft: 10 },
  disconnect: { paddingVertical: 12, alignItems: 'center', marginTop: 2 },
  disconnectText: { fontSize: 14, color: theme.danger, fontWeight: '500' },
});
