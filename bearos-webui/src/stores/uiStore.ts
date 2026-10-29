/*
 * SPDX-FileCopyrightText: 2020 Stalwart Labs LLC <hello@stalw.art>
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-SEL
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Theme = 'light' | 'dark';

interface UIState {
  theme: Theme;
  sidebarOpen: boolean;
  activeSection: string;

  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setActiveSection: (section: string) => void;
}

function applyThemeClass(theme: Theme) {
  if (theme === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      theme:
        typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
      sidebarOpen: typeof window !== 'undefined' ? (window.matchMedia?.('(min-width: 768px)').matches ?? true) : true,
      activeSection: '',

      toggleTheme: () => {
        const next = get().theme === 'light' ? 'dark' : 'light';
        applyThemeClass(next);
        set({ theme: next });
      },

      setTheme: (theme) => {
        applyThemeClass(theme);
        set({ theme });
      },

      toggleSidebar: () => {
        set({ sidebarOpen: !get().sidebarOpen });
      },

      setSidebarOpen: (open) => {
        set({ sidebarOpen: open });
      },

      setActiveSection: (section) => {
        set({ activeSection: section });
      },
    }),
    {
      name: 'stalwart-ui',
      partialize: (state) => ({
        theme: state.theme,
      }),
      onRehydrateStorage: () => {
        return (state) => {
          if (state) {
            applyThemeClass(state.theme);
          }
        };
      },
    },
  ),
);
