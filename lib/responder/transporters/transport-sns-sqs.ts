import {
  Server,
  CustomTransportStrategy,
  MessageHandler,
  IncomingRequest,
  OutgoingResponse,
  WritePacket,
  IncomingEvent,
} from '@nestjs/microservices';

import { SnsSqsOptions } from '../../interfaces/sns-sqs-options.interface';
import { SqsContext } from '../ctx-host';
import { SQSClient } from '../../sqs-client/sqs-client';
import { CONTROLLER_NAME, HANDLER_NAME } from '../../constants';
import { OutboundResponseSerializer } from '../serializers';
import { InboundMessageDeserializer } from '../deserializers';

import { Observable } from 'rxjs';
import { createHash } from 'node:crypto';

export class SnsSqsTransport extends Server implements CustomTransportStrategy {
  private sqsClient: SQSClient;
  private options: SnsSqsOptions;

  constructor(_options: SnsSqsOptions) {
    super();

    this.options = Object.assign(
      {
        serializer: new OutboundResponseSerializer(),
        deserializer: new InboundMessageDeserializer(),
      },
      _options,
    );

    // super class establishes the serializer and deserializer; sets up
    // defaults unless overridden via `options`
    this.initializeSerializer(this.options);
    this.initializeDeserializer(this.options);
  }

  /**
   * listen() is required by `CustomTransportStrategy` It's called by the
   * framework when the transporter is instantiated, and kicks off a lot of
   * the machinery.
   */
  public async listen(callback: () => void) {
    this.sqsClient = this.createSqsClient();
    await this.start(callback);
  }

  /**
   * get a connection to our AWS SQS client
   */
  public createSqsClient(): SQSClient {
    // The SQSClient provides a simple API to access AWS SQS
    // It automatically creates and listens to the required queues
    const { name, sqs } = this.options;
    return new SQSClient({ name, ...sqs });
  }

  /**
   * close() is required by `CustomTransportStrategy`...
   */
  public async close() {
    this.sqsClient && await this.sqsClient.destroy();
    this.sqsClient = null;
  }

  /**
   * kick things off
   */
  private async start(callback: () => void) {
    // register handler for error events
    this.sqsClient.onError(this.handleError);

    // register SQS/SNS message handlers
    await this.bindHandlers();

    // call any user-supplied callback from `app.listen()` call
    callback();
  }

  private async bindHandlers() {
    for (const [pattern, handler] of this.messageHandlers) {
      if (handler.isEventHandler) this.bindEventHandler(handler, pattern);
      else this.bindMessageHandler(handler, pattern);
    }
  }

  private async bindEventHandler(eventHandler: MessageHandler, pattern: string) {
    const queueName = this.sqsClient.getEventQueueName(`${pattern}_${this.normalizeExtras(eventHandler.extras)}`);
    const topicName = this.sqsClient.getEventTopicName(pattern);
    const handler = async (rawPacket: IncomingEvent) => {
      const sqsCtx = new SqsContext([pattern, queueName, topicName]);
      const packet = this.parsePacket(rawPacket);
      const message = await this.deserializer.deserialize(packet, {
        channel: pattern,
      });
      await eventHandler(message.data, sqsCtx);
    };
    await this.sqsClient.subscribe({ queueName, topicName, pattern, handler });
  }

  private async bindMessageHandler(handler: MessageHandler, pattern: string) {
    await this.sqsClient.subscribe({
      queueName: this.sqsClient.getAckQueueName(pattern),
      pattern,
      handler: this.getMessageHandler(pattern, handler),
    });
  }

  private getMessageHandler<T>(
    pattern: string,
    handler: (...arg: any[]) => Observable<T> | Promise<T>,
  ): (message: any) => void {
    return async (request: IncomingRequest & { responseQueueName: string }) => {
      const inboundPacket = await this.deserializer.deserialize(request, {
        channel: pattern,
      });
      const sqsCtx = new SqsContext([pattern]);
      const response$ = this.transformToObservable(await handler(inboundPacket.data, sqsCtx));

      const publishResponse = this.responsePublisherFactory(request.id, request.responseQueueName);

      response$ && this.send(response$, publishResponse);
    };
  }

  private responsePublisherFactory(id: string, responseQueueName: string) {
    return (writePacket: WritePacket) => {
      const response = Object.assign(writePacket, { id });

      const outgoingResponse: OutgoingResponse = this.serializer.serialize(response);

      return this.sqsClient.publish(responseQueueName, outgoingResponse);
    };
  }

  private parsePacket(content) {
    try {
      return JSON.parse(content);
    } catch (e) {
      return content;
    }
  }

  private normalizeExtras(extras: Record<string, any> = {}) {
    let identifier = '';
    if (extras[CONTROLLER_NAME] && typeof extras[CONTROLLER_NAME] === 'string')
      identifier += `_${extras[CONTROLLER_NAME]}`;
    if (extras[HANDLER_NAME] && typeof extras[HANDLER_NAME] === 'string') identifier += `_${extras[HANDLER_NAME]}`;
    return createHash('md5').update(identifier).digest('hex').substring(0, 8);
  }
}
