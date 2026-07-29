import type { Metadata } from 'next';
import { HistoryPage } from '@/components/chat/history-page';

export const metadata: Metadata = { title: '历史' };

export default function HistoryRoutePage() {
  return <HistoryPage />;
}
