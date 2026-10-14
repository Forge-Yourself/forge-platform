import { useLocalSearchParams } from 'expo-router';
import { BookingForm } from '../../../lib/schedule/BookingForm';

/** PT create. Entered from the + button, an open gap (date + time), or a client (clientId). */
export default function NewBooking() {
  const p = useLocalSearchParams<{ clientId?: string; date?: string; time?: string }>();
  return <BookingForm mode="new" initialClientId={p.clientId} initialDate={p.date} initialTime={p.time} />;
}
