import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../../lib/auth/AuthProvider';
import { useTheme } from '../../../theme/ThemeProvider';
import { Icon } from '../../../ui';

/**
 * The PT's four top-level destinations: Today, Clients, Programs, Library.
 * A stack made these a back-button crawl — a PT moves between the roster and
 * the program builder constantly mid-session, and that is what a tab bar is
 * for. This is the first navigation-structure change since M0, which is why
 * it landed before any M3 screen was written.
 *
 * A client sees no tab bar at all and cannot reach the three PT routes, even
 * by deep link (href: null removes them from the navigator entirely). One
 * tree, one branch — not a duplicated layout whose two copies drift.
 *
 * Icons come from ui/Icon, the app's own SVG set drawn on react-native-svg
 * (already a dependency). They replace the text glyphs (◆ ◎ ▦ ▤) this tab bar
 * shipped with, which rendered at a different weight and baseline on each
 * platform and had no Android system-font coverage for two of the four.
 *
 * Href form, per the regenerated .expo/types/router.d.ts (that file is the
 * arbiter, not this comment — it is gitignored and regenerates with the dev
 * server): the group prefix is REQUIRED, so a tab route is
 * '/(app)/(tabs)/clients', and the Today tab is plain '/'. Nested detail
 * screens stay outside this group — '/(app)/clients/[id]',
 * '/(app)/programs/[id]/builder' — so they push over the tab bar as full
 * screens rather than registering as tabs that each need href: null.
 */
export default function TabsLayout() {
  const { t } = useTranslation();
  const theme = useTheme();
  const auth = useAuth();
  const isClient = auth.user?.role === 'client';

  return (
    <Tabs
      tabBar={isClient ? () => null : undefined}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.accent,
        tabBarInactiveTintColor: theme.colors.textMuted,
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border,
          borderTopWidth: 1,
          height: 62,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarItemStyle: { paddingVertical: 2 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('common.tabs.today'),
          tabBarIcon: ({ color, focused }) => (
            <Icon name="flame" size={23} color={color} strokeWidth={focused ? 2.2 : 1.8} />
          ),
        }}
      />
      <Tabs.Screen
        name="clients"
        options={{
          title: t('common.tabs.clients'),
          href: isClient ? null : undefined,
          tabBarIcon: ({ color, focused }) => (
            <Icon name="users" size={23} color={color} strokeWidth={focused ? 2.2 : 1.8} />
          ),
        }}
      />
      <Tabs.Screen
        name="programs"
        options={{
          title: t('common.tabs.programs'),
          href: isClient ? null : undefined,
          tabBarIcon: ({ color, focused }) => (
            <Icon name="calendar" size={23} color={color} strokeWidth={focused ? 2.2 : 1.8} />
          ),
        }}
      />
      <Tabs.Screen
        name="library"
        options={{
          title: t('common.tabs.library'),
          href: isClient ? null : undefined,
          tabBarIcon: ({ color, focused }) => (
            <Icon name="dumbbell" size={23} color={color} strokeWidth={focused ? 2.2 : 1.8} />
          ),
        }}
      />
    </Tabs>
  );
}
