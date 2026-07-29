import type { Metadata } from 'next';
import { HomeChat } from '@/components/chat/home-chat';

export const metadata: Metadata = { title: '对话' };

export default function ChatPage() {
  return <HomeChat />;
}
