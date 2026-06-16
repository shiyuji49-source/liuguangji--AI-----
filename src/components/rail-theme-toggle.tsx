"use client";

import { useTheme } from "next-themes";
import { Sun, Moon } from "lucide-react";

/** Rail 主题切换：暗黑(纯黑黑金) ⇄ 白昼。图标用 CSS dark: 变体驱动，避免水合闪烁。 */
export function RailThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme !== "light";
  return (
    <button
      onClick={() => setTheme(isDark ? "light" : "dark")}
      title={isDark ? "切到白昼" : "切到暗黑"}
      suppressHydrationWarning
      className="flex size-10 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
    >
      <Sun className="hidden size-4 dark:block" />
      <Moon className="block size-4 dark:hidden" />
    </button>
  );
}
