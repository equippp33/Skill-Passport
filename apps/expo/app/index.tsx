import { SafeAreaView, StyleSheet, Text, View } from "react-native";

import {
  APP_NAME,
  SKILL_LEVELS,
  formatSkillLevel,
} from "@skill-passport/shared";

export default function HomeScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>{APP_NAME}</Text>
      <Text style={styles.subtitle}>
        Expo app · shares code with the Next.js app via @skill-passport/shared
      </Text>

      <View style={styles.row}>
        {SKILL_LEVELS.map((level) => (
          <View key={level} style={styles.pill}>
            <Text style={styles.pillText}>{formatSkillLevel(level)}</Text>
          </View>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", gap: 16, padding: 24 },
  title: { fontSize: 28, fontWeight: "600" },
  subtitle: { fontSize: 14, color: "#737373" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: {
    borderWidth: 1,
    borderColor: "#e5e5e5",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  pillText: { fontSize: 14 },
});
