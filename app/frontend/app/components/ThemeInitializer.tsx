"use client";
import { useEffect } from "react";
import { loadSavedTheme, applyTheme } from "@/lib/themes";

export function ThemeInitializer() {
  useEffect(() => {
    applyTheme(loadSavedTheme());
  }, []);
  return null;
}
