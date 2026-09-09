import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { APP_NAME } from "@skill-passport/shared";

export default function RootLayout() {
  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerTitle: APP_NAME }} />
    </>
  );
}
