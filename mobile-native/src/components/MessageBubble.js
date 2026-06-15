import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { theme } from '../theme';

export default function MessageBubble({ role, content }) {
  const isUser = role === 'user';

  if (isUser) {
    return (
      <View style={[styles.row, styles.rowRight]}>
        <View style={[styles.bubble, styles.user]}>
          <Text style={styles.userText} selectable>
            {content}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.row, styles.rowLeft]}>
      <View style={[styles.bubble, styles.assistant]}>
        <Markdown style={md}>{content || ''}</Markdown>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { width: '100%', paddingHorizontal: 16, marginBottom: 12, flexDirection: 'row' },
  rowRight: { justifyContent: 'flex-end' },
  rowLeft: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '86%', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 11 },
  user: { backgroundColor: theme.userBubble, borderBottomRightRadius: 6 },
  userText: { color: theme.userText, fontSize: 16, lineHeight: 22 },
  assistant: {
    backgroundColor: theme.assistantBg,
    borderWidth: 1,
    borderColor: theme.assistantBorder,
    borderBottomLeftRadius: 6,
  },
});

// Markdown styling tuned to the neutral system look.
const md = {
  body: { color: theme.text, fontSize: 16, lineHeight: 23 },
  heading1: { color: theme.text, fontSize: 20, fontWeight: '700', marginTop: 6, marginBottom: 4 },
  heading2: { color: theme.text, fontSize: 18, fontWeight: '700', marginTop: 6, marginBottom: 4 },
  heading3: { color: theme.text, fontSize: 16, fontWeight: '700', marginTop: 6, marginBottom: 2 },
  strong: { fontWeight: '700' },
  bullet_list: { marginVertical: 2 },
  list_item: { marginVertical: 1 },
  code_inline: {
    backgroundColor: theme.field,
    color: theme.text,
    borderRadius: 4,
    paddingHorizontal: 4,
    fontFamily: 'Menlo',
    fontSize: 14,
  },
  code_block: {
    backgroundColor: theme.field,
    borderRadius: 10,
    padding: 12,
    fontFamily: 'Menlo',
    fontSize: 13,
    color: theme.text,
  },
  fence: {
    backgroundColor: theme.field,
    borderRadius: 10,
    padding: 12,
    fontFamily: 'Menlo',
    fontSize: 13,
    color: theme.text,
  },
  link: { color: '#0A66C2' },
};
