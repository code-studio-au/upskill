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
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import { Queue, QueueEncryption } from "aws-cdk-lib/aws-sqs";
import { Topic } from "aws-cdk-lib/aws-sns";
import { EmailSubscription } from "aws-cdk-lib/aws-sns-subscriptions";
import type { Construct } from "constructs";
import type { EnvironmentConfig } from "./config.js";

export class StorageStack extends Stack {
  readonly quarantineBucket: Bucket;
  readonly learningBucket: Bucket;
  readonly privateBucket: Bucket;
  readonly artifactBucket: Bucket;
  readonly deadLetterQueue: Queue;
  readonly workQueue: Queue;
  readonly alarmTopic: Topic;

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
      lifecycleRules: [
        {
          expiration: Duration.days(90),
          noncurrentVersionExpiration: Duration.days(30),
          abortIncompleteMultipartUploadAfter: Duration.days(1),
        },
      ],
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
    this.alarmTopic = new Topic(this, "OperationalAlarmTopic", {
      displayName: `Upskill ${config.name} operational alarms`,
    });
    this.alarmTopic.addSubscription(new EmailSubscription(config.alarmEmail));
    const alarmDefaults = {
      evaluationPeriods: 2,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    } as const;
    const oldestMessageAlarm = new Alarm(this, "WorkQueueOldestMessageAlarm", {
      ...alarmDefaults,
      alarmName: `upskill-${config.name}-work-queue-oldest-message`,
      alarmDescription:
        "The durable work queue has contained an undelivered message for at least 15 minutes.",
      metric: this.workQueue.metricApproximateAgeOfOldestMessage({
        period: Duration.minutes(5),
      }),
      threshold: Duration.minutes(15).toSeconds(),
    });
    const backlogAlarm = new Alarm(this, "WorkQueueBacklogAlarm", {
      ...alarmDefaults,
      alarmName: `upskill-${config.name}-work-queue-backlog`,
      alarmDescription:
        "The durable work queue has sustained at least 100 visible messages.",
      metric: this.workQueue.metricApproximateNumberOfMessagesVisible({
        period: Duration.minutes(5),
      }),
      threshold: 100,
    });
    const deadLetterAlarm = new Alarm(this, "WorkDeadLetterQueueAlarm", {
      ...alarmDefaults,
      evaluationPeriods: 1,
      alarmName: `upskill-${config.name}-work-dead-letter-queue`,
      alarmDescription:
        "At least one durable work item has exhausted automatic delivery retries.",
      metric: this.deadLetterQueue.metricApproximateNumberOfMessagesVisible({
        period: Duration.minutes(5),
      }),
      threshold: 1,
    });
    for (const alarm of [oldestMessageAlarm, backlogAlarm, deadLetterAlarm])
      alarm.addAlarmAction(new SnsAction(this.alarmTopic));
    new CfnOutput(this, "ArtifactBucketName", {
      value: this.artifactBucket.bucketName,
    });
  }
}
