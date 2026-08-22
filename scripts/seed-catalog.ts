import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import {
  courseContentSchema,
  type CourseContent,
} from "#/features/catalog/catalog.schema";
import type { Database } from "#/server/db/types";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const seeds = [
  {
    id: "course_leading_through_change",
    versionId: "course_version_leading_through_change_1",
    slug: "leading-through-change",
    content: {
      title: "Leading through change",
      summary:
        "Practical tools for communicating clearly and sustaining trust through uncertainty.",
      description:
        "Build a practical change-leadership toolkit for planning communication, responding to uncertainty and helping teams maintain momentum.",
      topic: "leadership",
      durationMinutes: 75,
      priceCents: 14_900,
      salePriceCents: null,
      bulkPricing: {
        enabled: true,
        tiers: [
          { minimumQuantity: 5, unitPriceCents: 12_900 },
          { minimumQuantity: 20, unitPriceCents: 10_900 },
          { minimumQuantity: 50, unitPriceCents: 8_900 },
        ],
      },
      currency: "AUD",
      featured: true,
      listInStore: true,
      coverImage: null,
      hasCompletionCertificate: true,
      prerequisites: [],
      accreditations: [
        {
          name: "Continuing Professional Development",
          cpdPoints: 1.25,
          blurb: "",
          logoAssetId: null,
          logoName: "",
        },
      ],
      modules: [
        {
          title: "Change and the human response",
          phase: "content",
          durationMinutes: 25,
        },
        {
          title: "Communicating with clarity",
          phase: "content",
          durationMinutes: 30,
        },
        {
          title: "Your change leadership plan",
          phase: "post-learning",
          durationMinutes: 20,
        },
      ],
    },
  },
  {
    id: "course_psychological_safety",
    versionId: "course_version_psychological_safety_1",
    slug: "psychological-safety-at-work",
    content: {
      title: "Psychological safety at work",
      summary:
        "Build team habits that make it safe to ask questions, challenge assumptions and learn.",
      description:
        "Learn how everyday leadership behaviours shape psychological safety and practise ways to invite contribution, respond to mistakes and improve team learning.",
      topic: "safety",
      durationMinutes: 50,
      priceCents: 9_900,
      salePriceCents: 7_900,
      bulkPricing: {
        enabled: true,
        tiers: [
          { minimumQuantity: 5, unitPriceCents: 6_900 },
          { minimumQuantity: 20, unitPriceCents: 5_900 },
          { minimumQuantity: 50, unitPriceCents: 4_900 },
        ],
      },
      currency: "AUD",
      featured: true,
      listInStore: true,
      coverImage: null,
      hasCompletionCertificate: true,
      prerequisites: ["Suitable for people leaders and team facilitators"],
      accreditations: [
        {
          name: "Continuing Professional Development",
          cpdPoints: 1,
          blurb: "",
          logoAssetId: null,
          logoName: "",
        },
      ],
      modules: [
        {
          title: "What psychological safety means",
          phase: "pre-learning",
          durationMinutes: 10,
        },
        {
          title: "Leader responses that build trust",
          phase: "content",
          durationMinutes: 25,
        },
        {
          title: "Team practice plan",
          phase: "post-learning",
          durationMinutes: 15,
        },
      ],
    },
  },
  {
    id: "course_responsible_ai",
    versionId: "course_version_responsible_ai_1",
    slug: "responsible-ai-foundations",
    content: {
      title: "Responsible AI foundations",
      summary:
        "Use generative AI productively while recognising privacy, security and governance risks.",
      description:
        "Develop a grounded understanding of generative AI, learn to identify sensitive information and apply a repeatable decision process before using AI at work.",
      topic: "technology",
      durationMinutes: 90,
      priceCents: 17_900,
      salePriceCents: null,
      bulkPricing: {
        enabled: true,
        tiers: [
          { minimumQuantity: 5, unitPriceCents: 15_900 },
          { minimumQuantity: 20, unitPriceCents: 13_900 },
          { minimumQuantity: 50, unitPriceCents: 11_900 },
        ],
      },
      currency: "AUD",
      featured: true,
      listInStore: true,
      coverImage: null,
      hasCompletionCertificate: true,
      prerequisites: ["Basic familiarity with workplace digital tools"],
      accreditations: [],
      modules: [
        {
          title: "How generative AI works",
          phase: "content",
          durationMinutes: 25,
        },
        {
          title: "Privacy, security and intellectual property",
          phase: "content",
          durationMinutes: 35,
        },
        {
          title: "Responsible use decision guide",
          phase: "content",
          durationMinutes: 20,
        },
        {
          title: "Knowledge check",
          phase: "post-learning",
          durationMinutes: 10,
        },
      ],
    },
  },
] satisfies Array<{
  id: string;
  versionId: string;
  slug: string;
  content: CourseContent;
}>;

const database = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: databaseUrl }),
  }),
});

try {
  for (const seed of seeds) {
    const content = courseContentSchema.parse(seed.content);
    const course = await database
      .insertInto("course")
      .values({
        id: seed.id,
        slug: seed.slug,
        title: content.title,
        status: "published",
      })
      .onConflict((conflict) =>
        conflict.column("slug").doUpdateSet({
          title: content.title,
          status: "published",
          updatedAt: new Date(),
        }),
      )
      .returning("id")
      .executeTakeFirstOrThrow();

    await database
      .insertInto("course_version")
      .values({
        id: seed.versionId,
        courseId: course.id,
        version: 1,
        content,
        publishedAt: new Date("2026-08-08T00:00:00.000Z"),
      })
      .onConflict((conflict) =>
        conflict.columns(["courseId", "version"]).doUpdateSet({
          content,
          publishedAt: new Date("2026-08-08T00:00:00.000Z"),
        }),
      )
      .execute();
  }
  console.log(`Seeded ${String(seeds.length)} published courses`);
} finally {
  await database.destroy();
}
