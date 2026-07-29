import { redirect } from 'next/navigation';
import { ROOT_REDIRECT_TARGET } from '@/lib/navigation/app-routes';

/** UX01: root `/` always lands on chat draft shell. */
export default function RootPage() {
  redirect(ROOT_REDIRECT_TARGET);
}
