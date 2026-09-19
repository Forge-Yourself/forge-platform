import { router } from 'expo-router';

/**
 * Back from the metrics screen. It has two entry points (N13): a PT arrives
 * from client detail, a client from Today. dismissTo, not back(): a cold deep
 * link has nothing beneath it (N15).
 */
export function backFromBody(clientId: string, viewerIsClient: boolean): void {
  if (viewerIsClient) router.dismissTo('/');
  else router.dismissTo({ pathname: '/(app)/clients/[id]', params: { id: clientId } });
}

export function backToPhotos(clientId: string): void {
  router.dismissTo({ pathname: '/(app)/body/[clientId]/photos', params: { clientId } });
}

export function backToMetrics(clientId: string): void {
  router.dismissTo({ pathname: '/(app)/body/[clientId]', params: { clientId } });
}
