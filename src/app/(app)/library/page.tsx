import type { Metadata } from 'next';
import { LibraryPage } from '@/components/chat/library-page';

export const metadata: Metadata = { title: '资料库' };

export default function LibraryRoutePage() {
  return <LibraryPage />;
}
