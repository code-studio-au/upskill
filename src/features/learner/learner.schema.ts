type EnrollmentState = "active" | "completed" | "expired" | "cancelled";

export interface LearnerCourse {
  enrollmentId: string;
  slug: string;
  title: string;
  summary: string;
  durationMinutes: number;
  state: EnrollmentState;
  enrolledAt: string;
  completedAt: string | null;
  expiresAt: string | null;
}

export interface AvailableCourse {
  slug: string;
  title: string;
  summary: string;
  durationMinutes: number;
  domain: string;
}

export interface LearnerDashboard {
  user: {
    id: string;
    name: string;
    email: string;
    isPlatformAdministrator: boolean;
  };
  courses: Array<LearnerCourse>;
  availableCourses: Array<AvailableCourse>;
}
