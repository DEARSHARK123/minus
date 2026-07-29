import type { Metadata } from 'next';
import { SessionPage } from '@/components/chat/session-page';
import { learningRepository } from '@/lib/learning/repository';

type CourseRouteProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: CourseRouteProps): Promise<Metadata> {
  const { id } = await params;

  try {
    const data = await learningRepository.load();
    const course = data.courses.find((item) => item.id === id);
    return { title: course?.title?.trim() || '课程' };
  } catch {
    // Metadata must never prevent a course route from rendering.
    return { title: '课程' };
  }
}

export default function CourseRoutePage() {
  return <SessionPage />;
}
