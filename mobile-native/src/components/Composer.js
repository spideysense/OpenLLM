import React from 'react';
import { View, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { theme } from '../theme';

export default function Composer({ value, onChangeText, onSend, streaming, onStop }) {
  const canSend = value.trim().length > 0;

  function handlePress() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (streaming) onStop?.();
    else if (canSend) onSend?.();
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.field}>
        <TextInput
          style={styles.input}
          placeholder="Message your Aspen…"
          placeholderTextColor={theme.textMuted}
          value={value}
          onChangeText={onChangeText}
          multiline
          editable={!streaming}
        />
        <TouchableOpacity
          style={[styles.btn, !canSend && !streaming && styles.btnDisabled]}
          onPress={handlePress}
          activeOpacity={0.8}
          disabled={!canSend && !streaming}
        >
          <Ionicons name={streaming ? 'stop' : 'arrow-up'} size={20} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 6, backgroundColor: theme.bg },
  field: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: theme.bg,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 26,
    paddingLeft: 18,
    paddingRight: 6,
    paddingVertical: 6,
  },
  input: { flex: 1, fontSize: 16, color: theme.text, maxHeight: 120, paddingVertical: 8, paddingRight: 8 },
  btn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 1,
  },
  btnDisabled: { backgroundColor: '#C9C9CE' },
});
