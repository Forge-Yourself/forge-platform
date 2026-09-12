import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../../lib/auth/AuthProvider';
import { useTheme } from '../../../theme/ThemeProvider';
import { Text } from '../../../ui';

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
 * Icons are text glyphs on purpose: no icon font is in the dependency tree,
 * and M3 is not the milestone to add one. Revisit at M4.
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
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('common.tabs.today'),
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>◆</Text>,
        }}
      />
      <Tabs.Screen
        name="clients"
        options={{
          title: t('common.tabs.clients'),
          href: isClient ? null : undefined,
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>◎</Text>,
        }}
      />
      <Tabs.Screen
        name="library"
        options={{
          title: t('common.tabs.library'),
          href: isClient ? null : undefined,
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>▤</Text>,
        }}
      />
    </Tabs>
  );
}
