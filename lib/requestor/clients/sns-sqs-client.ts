import { Logger } from '@nestjs/common';
import { ClientProxy, ReadPacket, PacketId, WritePacket, IncomingResponse, ProducerSerializer, Serializer, OutgoingEvent, OutgoingRequest } from '@nestjs/microservices';
import { nanoid } from 'nanoid';

import { SnsSqsOptions } from '../../interfaces/sns-sqs-options.interface';
import { SQSClient } from '../../sqs-client/sqs-client';
import { QueueName } from '../../sqs-client/sqs.types';

export class SnsSqsClient extends ClientProxy {
  protected readonly logger = new Logger(SnsSqsClient.name);
  protected readonly subscriptionsCount = new Map<string, number>();
  protected sqsClient: SQSClient;
  declare protected serializer: Serializer<OutgoingEvent | (OutgoingRequest & { responseQueueName: QueueName }), any>
  private clientId: string;

  constructor(protected readonly options?: SnsSqsOptions) {
    super();
    this.clientId = nanoid(6);
    this.initializeSerializer(options);
    this.initializeDeserializer(options);
  }

  /**
   * Call close onModuleDestroy in case the client is directly injected 
   */
  public async onModuleDestroy() {
    await this.close();
  }

  protected publish(partialPacket: ReadPacket, callback: (packet: WritePacket) => any): () => void {
    try {
      const pattern = this.normalizePattern(partialPacket.pattern);
      const responseQueueName = this.sqsClient.getResQueueName(`${pattern}_${this.clientId}`);
      const packet = this.assignPacketId(partialPacket);
      const serializedPacket = this.serializer.serialize({ ...packet, responseQueueName });

      // start the subscription handler "bookkeeping"
      let subscriptionsCount = this.subscriptionsCount.get(responseQueueName) || 0;

      // build the call to publish the request; in addition to making the SQSClient
      // `publish()` call, when this function is called, it:
      // * updates the bookkeeping associated with the SQS subscription handler
      //   count
      // * stashes our *handler factory* in the map
      const publishRequest = () => {
        subscriptionsCount = this.subscriptionsCount.get(responseQueueName) || 0;
        this.subscriptionsCount.set(responseQueueName, subscriptionsCount + 1);
        this.routingMap.set(packet.id, callback);
        this.sqsClient.publish(this.sqsClient.getAckQueueName(pattern), serializedPacket);
      };

      // this is the function that does the late binding of the
      // *observable subscription function* to the SQS response channel
      const subscriptionHandler = this.createSubscriptionHandler(packet);

      if (subscriptionsCount <= 0) {
        const subscription = this.sqsClient.subscribe({
          pattern,
          queueName: responseQueueName,
          handler: subscriptionHandler,
        });
        subscription.then(() => publishRequest());
      } else {
        publishRequest();
      }

      return () => {
        this.unsubscribeFromQueue(responseQueueName);
        this.routingMap.delete(packet.id);
      };
    } catch (err) {
      callback({ err });
    }
  }

  protected async dispatchEvent(packet: ReadPacket): Promise<any> {
    const pattern = this.normalizePattern(packet.pattern);
    const serializedPacket = this.serializer.serialize(packet);
    const topic = this.sqsClient.getEventTopicName(pattern);
    return this.sqsClient.emit(topic, serializedPacket);
  }

  /**
   * connect
   * establishes the SQSClient and SNSClient
   *
   * This construct is expected by the framework.
   */
  public async connect(): Promise<any> {
    if (this.sqsClient) {
      return this.sqsClient;
    }
    const { name, sqs } = this.options;
    this.sqsClient = new SQSClient({ name, ...sqs });

    this.handleError(this.sqsClient);
    return this.sqsClient;
  }

  /**
   * Required by the Framework
   */
  public async close() {
    this.sqsClient && await this.sqsClient.destroy();
    this.sqsClient = null;
  }

  private createSubscriptionHandler(packet: ReadPacket & PacketId): (rawPacket: IncomingResponse) => Promise<any> {
    return async (rawPacket: IncomingResponse) => {
      const message = await this.deserializer.deserialize(rawPacket);
      const { err, response, isDisposed, id } = message;

      const callback = this.routingMap.get(id);
      if (!callback) {
        return undefined;
      }

      if (isDisposed || err) {
        return callback({
          err,
          response,
          isDisposed: true,
        });
      }
      callback({
        err,
        response,
      });
    };
  }

  private unsubscribeFromQueue(queueName: QueueName) {
    const subscriptionCount = this.subscriptionsCount.get(queueName);
    this.subscriptionsCount.set(queueName, subscriptionCount - 1);

    if (subscriptionCount - 1 <= 0) {
      this.sqsClient.unsubscribe(queueName);
    }
  }

  private handleError(client: SQSClient) {
    client.onError((error) => {
      this.logger.log(error);
    });
  }
}
