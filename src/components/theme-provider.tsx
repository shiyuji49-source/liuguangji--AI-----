"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/** 全站主题（暗=纯黑黑金 / 亮=白昼）。class 策略，默认暗色。 */
export function ThemeProvider({ children, ...props }: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
