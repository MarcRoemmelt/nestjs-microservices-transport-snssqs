import {
  ConsumerDeserializer,
  IncomingRequest,
  IncomingEvent,
} from '@nestjs/microservices';
import { Logger } from '@nestjs/common';

export class InboundMessageDeserializer
  implements ConsumerDeserializer {
  private readonly logger = new Logger(InboundMessageDeserializer.name);

  deserialize(request: any, options?: Record<string, any>): IncomingRequest | IncomingEvent {
    this.logger.debug({ message: 'Deserializing inbound request', request });
    if (this.isSNSNotification(request)) return JSON.parse(request.Message);
    return request;
  }

  private isSNSNotification(request: unknown): request is { Message: string } {
    if (typeof request === 'object' && 'Type' in request && request['Type'] === 'Notification') return true;
    return false;
  }
}
