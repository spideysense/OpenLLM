import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { theme } from '../theme';
import { streamChat } from '../api';
import MessageBubble from '../components/MessageBubble';
import Composer from '../components/Composer';
import ThinkingIndicator from '../components/ThinkingIndicator';

export default function ChatScreen({ config, model, onDisconnect }) {
  const [messages, setMessages] = useState([]); // {role, content}
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [status, setStatus] = useState('');
  const abortRef = useRef(null);
  const listRef = useRef(null);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: false }));
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    const history = [...messages, { role: 'user', content: text }];
    setMessages([...history, { role: 'assistant', content: '' }]);
    setInput('');
    setStreaming(true);
    setStatus('');
    scrollToEnd();

    const controller = new AbortController();
    abortRef.current = controller;
    let acc = '';
    let flushTimer = null;

    // Batch token updates to ~16/sec instead of re-rendering per token — keeps
    // scrolling and typing smooth even on a fast stream.
    const commit = () => {
      flushTimer = null;
      setMessages((prev) => {
        const n = [...prev];
        n[n.length - 1] = { role: 'assistant', content: acc };
        return n;
      });
      scrollToEnd();
    };
    const scheduleFlush = () => {
      if (flushTimer == null) flushTimer = setTimeout(commit, 60);
    };
    const flushNow = () => {
      if (flushTimer != null) { clearTimeout(flushTimer); flushTimer = null; }
      commit();
    };

    await streamChat({
      tunnelUrl: config.tunnelUrl,
      apiKey: config.apiKey,
      model,
      messages: history,
      signal: controller.signal,
      onStatus: (s) => setStatus(s),
      onDelta: (d) => {
        acc += d;
        if (status) setStatus('');
        scheduleFlush();
      },
      onError: (err) => {
        acc = acc || `⚠️ ${err}`;
        flushNow();
      },
      onDone: () => {
        flushNow();
        setStreaming(false);
        setStatus('');
        abortRef.current = null;
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      },
    });
  }, [input, streaming, messages, config, model, scrollToEnd, status]);

  function stop() {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
    setStatus('');
  }

  function newChat() {
    if (streaming) stop();
    setMessages([]);
    setStatus('');
  }

  // The last assistant bubble is a placeholder while we wait for the first token.
  const lastIsEmptyAssistant =
    messages.length > 0 &&
    messages[messages.length - 1].role === 'assistant' &&
    messages[messages.length - 1].content === '';

  const visible = lastIsEmptyAssistant ? messages.slice(0, -1) : messages;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onDisconnect} hitSlop={10} style={styles.headerBtn}>
          <Ionicons name="ellipsis-horizontal" size={22} color={theme.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          Aspen
        </Text>
        <TouchableOpacity onPress={newChat} hitSlop={10} style={styles.headerBtn}>
          <Ionicons name="create-outline" size={22} color={theme.text} />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        <FlatList
          ref={listRef}
          style={{ flex: 1 }}
          contentContainerStyle={styles.list}
          data={visible}
          keyExtractor={(_, i) => String(i)}
          renderItem={({ item, index }) => (
            <MessageBubble
              role={item.role}
              content={item.content}
              streaming={streaming && item.role === 'assistant' && index === visible.length - 1}
            />
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Ask Aspen anything</Text>
              <Text style={styles.emptySub}>Running privately on your machine.</Text>
            </View>
          }
          ListFooterComponent={streaming && lastIsEmptyAssistant ? <ThinkingIndicator status={status} /> : null}
          onContentSizeChange={scrollToEnd}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          removeClippedSubviews
          initialNumToRender={12}
          maxToRenderPerBatch={8}
          windowSize={11}
        />

        <Composer
          value={input}
          onChangeText={setInput}
          onSend={send}
          streaming={streaming}
          onStop={stop}
        />

        <Text style={styles.footer}>
          Running on your machine{model ? ` · ${model}` : ''}
        </Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.hairline,
  },
  headerBtn: { width: 32, alignItems: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '600', color: theme.text },
  list: { paddingTop: 16, paddingBottom: 8, flexGrow: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 120 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: theme.text, marginBottom: 6 },
  emptySub: { fontSize: 14, color: theme.textMuted },
  footer: {
    textAlign: 'center',
    fontSize: 11,
    color: theme.textMuted,
    paddingBottom: Platform.OS === 'ios' ? 6 : 10,
    paddingTop: 2,
  },
});
