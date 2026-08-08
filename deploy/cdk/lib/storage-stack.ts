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
import { Queue, QueueEncryption } from "aws-cdk-lib/aws-sqs";
import type { Construct } from "constructs";
import type { EnvironmentConfig } from "./config.js";

export class StorageStack extends Stack {
  readonly quarantineBucket: Bucket;
  readonly learningBucket: Bucket;
  readonly privateBucket: Bucket;
  readonly artifactBucket: Bucket;
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

    const deadLetterQueue = new Queue(this, "WorkDeadLetterQueue", {
      encryption: QueueEncryption.KMS_MANAGED,
      retentionPeriod: Duration.days(14),
    });
    this.workQueue = new Queue(this, "WorkQueue", {
      encryption: QueueEncryption.KMS_MANAGED,
      visibilityTimeout: Duration.minutes(15),
      deadLetterQueue: { queue: deadLetterQueue, maxReceiveCount: 5 },
    });
    new CfnOutput(this, "ArtifactBucketName", {
      value: this.artifactBucket.bucketName,
    });
  }
}
