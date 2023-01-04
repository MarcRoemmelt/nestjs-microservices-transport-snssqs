import { Serializer, OutgoingResponse } from '@nestjs/microservices';
import { Logger } from '@nestjs/common';

export class OutboundResponseSerializer implements Serializer {
  private readonly logger = new Logger(OutboundResponseSerializer.name);
  serialize(response: any): OutgoingResponse {
    this.logger.debug({ message: 'Serializing outbound response', response })
    try {
      return JSON.parse(response);
    } catch (_) {
      return response;
    }
  }
}
