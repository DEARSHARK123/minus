import type { Metadata } from 'next';
import { CalendarPage } from '@/components/chat/calendar-page';

export const metadata: Metadata = { title: '日历' };

export default function CalendarRoutePage() {
  return <CalendarPage />;
}
