import type { Credentials } from '@aws-sdk/types';
import type { QueueAttributeName } from '@aws-sdk/client-sqs';
import type { Consumer } from 'sqs-consumer-v3';

export type QueueName = string;
export type QueueUrl = string;
export type TopicName = string;
export type TopicArn = string;

export type Attributes = Partial<Record<QueueAttributeName, string>>;

export interface IConsumer {
  consumer: Consumer;
  queue: IQueue;
}
export interface IQueue {
  queueName: QueueName;
  queueUrl: QueueUrl;
  attributes: Attributes;
}
export interface ITopic {
  topicName: TopicName;
  topicArn: TopicArn;
}

export interface SqsOptions {
  name?: string;
  deadLetterQueueName: string;
  region: string;
  credentials?: Credentials;
};
