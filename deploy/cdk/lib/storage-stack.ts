import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
} from "aws-cdk-lib";
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  ObjectOwnership,
} from "aws-cdk-lib/aws-s3";
import {
  Alarm,
  ComparisonOperator,
  TreatMissingData,
} from "aws-cdk-lib/aws-cloudwatch";
import { Queue, QueueEncryption } from "aws-cdk-lib/aws-sqs";
import type { Construct } from "constructs";
import type { EnvironmentConfig } from "./config.js";

export class StorageStack extends Stack {
  readonly quarantineBucket: Bucket;
  readonly learningBucket: Bucket;
  readonly privateBucket: Bucket;
  readonly artifactBucket: Bucket;
  readonly deadLetterQueue: Queue;
  readonly workQueue: Queue;

  constructor(
    scope: Construct,
    id: string,
    config: EnvironmentConfig,
    props?: StackProps,
  ) {
    super(scope, id, props);
    const bucketDefaults = {
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy:
        config.name === "production"
          ? RemovalPolicy.RETAIN
          : RemovalPolicy.DESTROY,
    } as const;

    this.quarantineBucket = new Bucket(this, "QuarantineBucket", {
      ...bucketDefaults,
      lifecycleRules: [{ expiration: Duration.days(7) }],
    });
    this.learningBucket = new Bucket(this, "LearningBucket", {
      ...bucketDefaults,
      versioned: true,
    });
    this.privateBucket = new Bucket(this, "PrivateBucket", {
      ...bucketDefaults,
      versioned: true,
    });
    this.artifactBucket = new Bucket(this, "ArtifactBucket", {
      ...bucketDefaults,
      versioned: true,
      lifecycleRules: [{ noncurrentVersionExpiration: Duration.days(30) }],
    });

    this.deadLetterQueue = new Queue(this, "WorkDeadLetterQueue", {
      encryption: QueueEncryption.KMS_MANAGED,
      retentionPeriod: Duration.days(14),
    });
    this.workQueue = new Queue(this, "WorkQueue", {
      encryption: QueueEncryption.KMS_MANAGED,
      visibilityTimeout: Duration.minutes(15),
      deadLetterQueue: { queue: this.deadLetterQueue, maxReceiveCount: 5 },
    });
    if (config.name === "production") {
      const alarmDefaults = {
        evaluationPeriods: 2,
        comparisonOperator:
          ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      } as const;
      new Alarm(this, "WorkQueueOldestMessageAlarm", {
        ...alarmDefaults,
        alarmName: "upskill-production-work-queue-oldest-message",
        alarmDescription:
          "The durable work queue has contained an undelivered message for at least 15 minutes.",
        metric: this.workQueue.metricApproximateAgeOfOldestMessage({
          period: Duration.minutes(5),
        }),
        threshold: Duration.minutes(15).toSeconds(),
      });
      new Alarm(this, "WorkQueueBacklogAlarm", {
        ...alarmDefaults,
        alarmName: "upskill-production-work-queue-backlog",
        alarmDescription:
          "The durable work queue has sustained at least 100 visible messages.",
        metric: this.workQueue.metricApproximateNumberOfMessagesVisible({
          period: Duration.minutes(5),
        }),
        threshold: 100,
      });
      new Alarm(this, "WorkDeadLetterQueueAlarm", {
        ...alarmDefaults,
        evaluationPeriods: 1,
        alarmName: "upskill-production-work-dead-letter-queue",
        alarmDescription:
          "At least one durable work item has exhausted automatic delivery retries.",
        metric: this.deadLetterQueue.metricApproximateNumberOfMessagesVisible({
          period: Duration.minutes(5),
        }),
        threshold: 1,
      });
    }
    new CfnOutput(this, "ArtifactBucketName", {
      value: this.artifactBucket.bucketName,
    });
  }
}
