import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet, Easing } from 'react-native';
import { theme } from '../theme';

function Dot({ delay }) {
  const v = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 450, delay, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0.3, duration: 450, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [v, delay]);
  return <Animated.View style={[styles.dot, { opacity: v }]} />;
}

// Shows the live agent activity ("Searching the web…", "Loading model into
// memory…") when there's a status, otherwise three pulsing dots.
export default function ThinkingIndicator({ status }) {
  return (
    <View style={[styles.row]}>
      <View style={styles.bubble}>
        {status ? (
          <Text style={styles.status}>{status}</Text>
        ) : (
          <View style={styles.dots}>
            <Dot delay={0} />
            <Dot delay={150} />
            <Dot delay={300} />
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { width: '100%', paddingHorizontal: 16, marginBottom: 12, flexDirection: 'row', justifyContent: 'flex-start' },
  bubble: {
    backgroundColor: theme.assistantBg,
    borderWidth: 1,
    borderColor: theme.assistantBorder,
    borderRadius: 20,
    borderBottomLeftRadius: 6,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 44,
    justifyContent: 'center',
  },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: theme.textMuted },
  status: { color: theme.textMuted, fontSize: 15 },
});
