import { z } from "#/validation/zod";
import type {
  LearnerSurveyProgress,
  SurveyVersionContent,
} from "#/features/survey/survey.schema";

const identifier = z.string().check(z.trim(), z.minLength(1), z.maxLength(255));

export const onboardingProfileMappingSchema = z.object({
  questionId: identifier,
  destination: z.enum(["name", "phone", "currentRegionId"]),
});

export const activateOnboardingSchema = z
  .object({
    surveyVersionId: identifier,
    privacyNotice: z
      .string()
      .check(z.trim(), z.minLength(1), z.maxLength(10_000)),
    privacyNoticeVersion: z
      .string()
      .check(z.trim(), z.minLength(1), z.maxLength(80)),
    profileMappings: z
      .array(onboardingProfileMappingSchema)
      .check(z.maxLength(3)),
  })
  .check(
    z.superRefine((value, context) => {
      const questions = new Set<string>();
      const destinations = new Set<string>();
      for (const [index, mapping] of value.profileMappings.entries()) {
        if (questions.has(mapping.questionId))
          context.addIssue({
            code: "custom",
            path: ["profileMappings", index, "questionId"],
            message: "Each question can update only one profile field",
          });
        if (destinations.has(mapping.destination))
          context.addIssue({
            code: "custom",
            path: ["profileMappings", index, "destination"],
            message: "Each profile field can be mapped only once",
          });
        questions.add(mapping.questionId);
        destinations.add(mapping.destination);
      }
    }),
  );

export const onboardingStepSchema = z.object({
  assignmentId: identifier,
  itemId: identifier,
  answer: z.optional(
    z.union([
      z.string().check(z.maxLength(10_000)),
      z.array(identifier).check(z.maxLength(500)),
      z.boolean(),
      z.number(),
    ]),
  ),
});

interface OnboardingSurveyVersionOption {
  id: string;
  surveyId: string;
  title: string;
  version: number;
  content: SurveyVersionContent;
}

export interface OnboardingConfiguration {
  id: string;
  version: number;
  surveyVersionId: string;
  surveyTitle: string;
  surveyVersion: number;
  privacyNotice: string;
  privacyNoticeVersion: string;
  profileMappings: Array<z.infer<typeof onboardingProfileMappingSchema>>;
  activatedAt: string;
  deactivatedAt: string | null;
}

export interface AdminOnboardingData {
  active: OnboardingConfiguration | null;
  history: Array<OnboardingConfiguration>;
  surveyVersions: Array<OnboardingSurveyVersionOption>;
}

export type AdminOnboardingResult =
  | { status: "ready"; data: AdminOnboardingData }
  | { status: "unauthenticated" }
  | { status: "forbidden" };

export type AdminOnboardingMutationResult =
  | { status: "ready"; data: { configurationId: string } }
  | { status: "invalid"; message: string }
  | { status: "unauthenticated" }
  | { status: "forbidden" };

export interface LearnerOnboarding {
  assignmentId: string;
  privacyNotice: string;
  privacyNoticeVersion: string;
  content: SurveyVersionContent;
  progress: LearnerSurveyProgress;
  submittedAt: string | null;
}

export type LearnerOnboardingResult =
  | { status: "ready"; data: LearnerOnboarding }
  | { status: "complete" }
  | { status: "not-configured" }
  | { status: "unauthenticated" };

export type LearnerOnboardingStepResult =
  | {
      status: "advanced" | "submitted";
      progress: LearnerSurveyProgress;
      completedCourse: false;
    }
  | { status: "invalid"; message: string }
  | { status: "not-found" }
  | { status: "unavailable" }
  | { status: "unauthenticated" };
