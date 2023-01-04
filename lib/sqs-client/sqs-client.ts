import * as SNS from '@aws-sdk/client-sns';
import * as SQS from '@aws-sdk/client-sqs';
import { Consumer } from 'sqs-consumer-v3';
import { noop } from 'rxjs';
import { IncomingEvent, IncomingRequest, IncomingResponse } from '@nestjs/microservices';
import { Logger } from '@nestjs/common';
import { randomStringGenerator } from '@nestjs/common/utils/random-string-generator.util';

import { IConsumer, IQueue, ITopic, QueueName, QueueUrl, SqsOptions, TopicName } from './sqs.types';

export class SQSClient {
  private readonly logger = new Logger('SQSClient');
  private readonly consumers = new Map<QueueName, IConsumer>();
  private readonly sqsQueues = new Map<QueueName, IQueue>();
  private readonly snsTopics = new Map<TopicName, ITopic>();
  private readonly options: SqsOptions;

  private sqsClient: SQS.SQSClient;
  private snsClient: SNS.SNSClient;

  public constructor(_options: SqsOptions) {
    this.options = Object.assign({}, _options);
    this.sqsClient = this.getSQSClient();
    this.snsClient = this.getSNSClient();
  }

  /**
   * Ensure SQS consumer exists for given `queueName`.
   *
   * Executes `handler` for each message from queue.
   *
   * If `topicName` is passed, subscribe queue to this SNS topic.
   */
  public async subscribe({
    pattern,
    queueName,
    topicName,
    handler,
  }: {
    pattern: string;
    queueName: QueueName;
    topicName?: TopicName;
    handler: (message: IncomingEvent | IncomingRequest | IncomingResponse) => void | Promise<void>;
  }) {
    try {
      return await this.ensureSQSConsumer({ queueName, topicName, handler: this.getHandler(pattern, handler) });
    } catch (error) {
      this.errorHandler(error);
    }
  }

  public unsubscribe(queueName: QueueName) {
    const consumer = this.consumers.get(queueName);
    if (!consumer) return;
    consumer.consumer.stop();
    consumer.consumer['handleMessage'] = noop;
  }

  /**
   * Publishes SQS messages to provided `queueName`.
   *
   * If no queue with this name exists, it is created.
   */
  public async publish(queueName: QueueName, payload: unknown | unknown[]) {
    await this.ensureSQSProducer(queueName);

    const originalMessages = Array.isArray(payload) ? payload : [payload];
    const messages: SQS.SendMessageBatchRequestEntry[] = originalMessages.map((message) => ({
      Id: message.id,
      MessageBody: typeof message === 'string' ? message : JSON.stringify(message),
    }));

    const queueUrl = await this.getQueueUrl(queueName);
    const command = new SQS.SendMessageBatchCommand({
      QueueUrl: queueUrl,
      Entries: messages,
    });
    try {
      const result = await this.sqsClient.send(command);
      result.Failed?.forEach((entry) => this.logger.error({ message: 'Failed to publish entry to SQS', entry }));
      return result;
    } catch (error) {
      this.errorHandler(error);
    }
  }

  /**
   * Publishes SNS messages to provided `topicName`
   */
  public async emit(topicName: TopicName, payload: unknown | unknown[]) {
    const topic = await this.ensureTopic(topicName);
    const originalEvents = Array.isArray(payload) ? payload : [payload];
    const events = originalEvents.map((event) => ({
      Id: event.id ?? randomStringGenerator(),
      Message: JSON.stringify(event),
    }));
    const command = new SNS.PublishBatchCommand({
      TopicArn: topic.topicArn,
      PublishBatchRequestEntries: events,
    });
    try {
      const result = await this.snsClient.send(command);
      result.Failed?.forEach((entry) => this.logger.error({ message: 'Failed to publish event to SNS', entry }));
      return result;
    } catch (error) {
      this.errorHandler(error);
    }
  }

  public async destroy() {
    for (const consumer of this.consumers.values()) {
      consumer.consumer.stop();
      consumer.consumer['handleMessage'] = noop;
      if (this.isResponseQueue(consumer.queue.queueName)) {
        await this.deleteQueue(consumer.queue.queueUrl);
      }
    }
    this.errorHandler = null;
  }

  private async deleteQueue(queueUrl: QueueUrl) {
    const deleteQueueCommand = new SQS.DeleteQueueCommand({ QueueUrl: queueUrl });
    const result = await this.sqsClient.send(deleteQueueCommand);
  }

  public onError(fn: (error: string) => void) {
    this.errorHandler = fn;
  }

  public getAckQueueName(pattern: string): `${string}_ack` {
    if (pattern.length > 76) throw new Error(`Pattern too long. MessagePatterns can at most be 76 characters long. Received ${pattern.length} - ${pattern}`)
    return `${pattern}_ack`;
  }

  public getResQueueName(pattern: string): `${string}_res` {
    if (pattern.length > 76) throw new Error(`Pattern too long. MessagePatterns can at most be 69 characters long. Received ${pattern.length} - ${pattern}`)
    return `${pattern}_res`;
  }
  public getEventQueueName(pattern: string): string {
    const queueName = this.options.name ? `${this.options.name}_${pattern}` : `${pattern}`;
    if (queueName.length > 71) throw new Error(`Pattern too long. EventPatterns can at most be 71 characters long. Received ${pattern.length} - ${pattern}`)
    return queueName;
  }
  public getEventTopicName(pattern: string): string {
    return pattern;
  }

  private async ensureSQSConsumer(payload: {
    topicName?: TopicName;
    queueName: QueueName;
    handler: (message: SQS.Message) => Promise<void>;
  }) {
    const consumer = this.consumers.get(payload.queueName);

    if (consumer?.consumer) {
      consumer.consumer['handleMessage'] = payload.handler;
      consumer.consumer.start();
      return;
    }

    await this.createConsumer(payload);
  }

  private async ensureSQSProducer(queueName: QueueName) {
    await this.ensureQueue(queueName);
  }

  private async createConsumer(payload: {
    topicName?: TopicName;
    queueName: QueueName;
    handler: (message: SQS.Message) => Promise<void>;
  }) {
    const queue = await this.ensureQueue(payload.queueName);
    if (payload.topicName) await this.subscribeQueueToTopic(payload.queueName, payload.topicName);

    const newConsumer = Consumer.create({
      queueUrl: queue.queueUrl,
      handleMessage: payload.handler,
      sqs: this.getSQSClient(),
      waitTimeSeconds: 0,
      terminateVisibilityTimeout: true,
    });

    this.handleError(newConsumer);

    const consumer = {
      consumer: newConsumer,
      queue,
    };
    this.consumers.set(payload.queueName, consumer);

    newConsumer.start();
  }

  private async ensureQueue(queueName: string): Promise<IQueue> {
    const existingQueue = this.sqsQueues.get(queueName);
    if (existingQueue) return existingQueue;

    const attributes = {};
    if (queueName !== this.options.deadLetterQueueName) {
      const deadLetterQueue = await this.ensureQueue(this.options.deadLetterQueueName);
      Object.assign(attributes, {
        RedrivePolicy: JSON.stringify({ deadLetterTargetArn: deadLetterQueue.attributes.QueueArn, maxReceiveCount: 3 }),
      });
    }

    const queue = await this.createQueue(queueName, attributes);
    return queue;
  }

  private isRequestQueue(queueName: QueueName) {
    return /_ack$/.test(queueName)
  }
  private isResponseQueue(queueName: QueueName) {
    return /_res$/.test(queueName)
  }
  private getVisibilityTimeoutForQueue(queueName: QueueName) {
    /* Request Queue. All clients in a service listen, one single execution is sufficient */
    if (this.isRequestQueue(queueName)) return '10';

    /* Response Queue.  */
    if (this.isResponseQueue(queueName)) return '5';

    /* Event Queue. All clients per service listen, one single execution is sufficient. */
    return '10';
  }
  private async createQueue(
    queueName: string,
    _attributes: Partial<Record<SQS.QueueAttributeName, string>> = {},
  ): Promise<IQueue> {
    const command = new SQS.CreateQueueCommand({
      QueueName: queueName,
      tags: {},
      Attributes: Object.assign(
        {
          VisibilityTimeout: this.getVisibilityTimeoutForQueue(queueName),
          ReceiveMessageWaitTimeSeconds: '20',
        },
        _attributes,
      ),
    });

    const result = await this.sqsClient.send(command);
    this.logger.verbose(`Ensured SQS queue: ${queueName}`);

    const queueUrl = result.QueueUrl || (await this.getQueueUrl(queueName));
    const attributes = await this.getQueueAttributes(queueUrl);
    const queue = { queueName, queueUrl, attributes };
    this.sqsQueues.set(queueName, queue);

    return queue;
  }

  private async getQueueUrl(queueName: string): Promise<string | undefined> {
    const command = new SQS.GetQueueUrlCommand({
      QueueName: queueName,
    });
    const result = await this.sqsClient.send(command);
    return result.QueueUrl;
  }

  private async getQueueAttributes(
    queueUrl: QueueUrl,
  ): Promise<undefined | { [key in Exclude<SQS.QueueAttributeName, 'All'>]: string }> {
    const command = new SQS.GetQueueAttributesCommand({
      QueueUrl: queueUrl,
      AttributeNames: ['All'],
    });
    const response = await this.sqsClient.send(command);
    return response.Attributes as any;
  }

  private async subscribeQueueToTopic(queueName: QueueName, topicName: TopicName) {
    const queue = await this.ensureQueue(queueName);
    const attributes = queue.attributes;
    const topic = await this.ensureTopic(topicName);

    const newPolicy = {
      Effect: 'Allow',
      Principal: {
        Service: 'sns.amazonaws.com',
      },
      Action: 'sqs:SendMessage',
      Resource: queue.attributes.QueueArn,
      Condition: {
        ArnEquals: {
          'aws:SourceArn': topic.topicArn,
        },
      },
    };
    await this.setQueuePolicies(queueName, newPolicy);

    const command = new SNS.SubscribeCommand({
      TopicArn: topic.topicArn,
      Protocol: 'sqs',
      Endpoint: attributes.QueueArn,
    });
    await this.snsClient.send(command);
  }

  private async setQueuePolicies(queueName: QueueName, policies: any | any[]) {
    const queue = await this.ensureQueue(queueName);
    const existingPolicy = JSON.parse(queue.attributes.Policy || '{}');
    const addedPolicies = Array.isArray(policies) ? policies : [policies];
    const newPolicy = Object.assign(existingPolicy, {
      Statement: [...(existingPolicy.Statement ?? []), ...addedPolicies],
    });
    const setPolicyCommand = new SQS.SetQueueAttributesCommand({
      QueueUrl: queue.queueUrl,
      Attributes: {
        Policy: JSON.stringify(newPolicy),
      },
    });
    await this.sqsClient.send(setPolicyCommand);
  }

  private async ensureTopic(topicName: TopicName) {
    const existingTopic = this.snsTopics.get(topicName);
    if (existingTopic) return existingTopic;

    const command = new SNS.CreateTopicCommand({
      Name: topicName,
    });
    const result = await this.snsClient.send(command);
    this.logger.verbose(`Ensured SNS topic: ${topicName}`);

    const topic = { topicName, topicArn: result.TopicArn };
    this.snsTopics.set(topicName, topic);

    return topic;
  }

  private errorHandler: (error: string) => void;
  private handleError(consumer: Consumer) {
    consumer.on('error', (error: Error, message: void | SQS.Message | SQS.Message[]) => {
      this.errorHandler(error.toString());
    });
    consumer.on('processing_error', (error: Error, message: void | SQS.Message | SQS.Message[]) =>
      this.errorHandler(error.toString()),
    );
    consumer.on('timeout_error', (error: Error, message: void | SQS.Message | SQS.Message[]) =>
      this.errorHandler(error.toString()),
    );
  }

  private getHandler(
    pattern: string,
    handler: (message: IncomingEvent | IncomingRequest | IncomingResponse) => void | Promise<void>,
  ) {
    return async (message: SQS.Message) => {
      try {
        const data = JSON.parse(message.Body);
        await handler(data);
      } catch (e) {
        this.logger.warn({ message: 'Invalid message structure. Expected type SQS.Message', received: message });
        await handler({ pattern, data: message.Body });
      }
    };
  }

  private getSQSClient() {
    if (!this.sqsClient) {
      this.sqsClient = new SQS.SQSClient({
        region: this.options.region,
        credentials: this.options.credentials,
      });
    }
    return this.sqsClient;
  }
  private getSNSClient() {
    if (!this.snsClient) {
      this.snsClient = new SNS.SNSClient({
        region: this.options.region,
        credentials: this.options.credentials,
      });
    }
    return this.snsClient;
  }
}
