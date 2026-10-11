import { useLocalSearchParams } from 'expo-router';
import { BookingDetailBody } from '../../../../lib/schedule/BookingDetailBody';

export default function BookingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <BookingDetailBody id={id} />;
}
