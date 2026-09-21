import { router } from 'expo-router';

/**
 * Where the body screens came from. It started as a boolean — "is the viewer
 * the client?" — which read any other viewer as "a PT looking at somebody
 * else" and sent them to that client's detail screen. A PT looking at their
 * OWN record is a third case: there is no client-detail frame to return to
 * (/(app)/clients/<selfClientId> redirects straight back to /me), so the
 * boolean would have replaced the screen, mounted it, and bounced — working,
 * but looking broken.
 */
export type BodyOrigin = 'home' | 'me' | 'client';

/**
 * Back from the metrics screen. It has three entry points (N13): a client
 * arrives from Today, a PT from client detail, and a PT from their own /me.
 * dismissTo, not back(): a cold deep link has nothing beneath it (N15).
 */
export function backFromBody(clientId: string, origin: BodyOrigin): void {
  if (origin === 'home') router.dismissTo('/');
  else if (origin === 'me') router.dismissTo('/(app)/me');
  else router.dismissTo({ pathname: '/(app)/clients/[id]', params: { id: clientId } });
}

export function backToPhotos(clientId: string): void {
  router.dismissTo({ pathname: '/(app)/body/[clientId]/photos', params: { clientId } });
}

export function backToMetrics(clientId: string): void {
  router.dismissTo({ pathname: '/(app)/body/[clientId]', params: { clientId } });
}
