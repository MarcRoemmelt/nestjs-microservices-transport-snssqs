import type { Serializer } from '@nestjs/microservices';
import { Logger } from '@nestjs/common';

export class OutboundMessageIdentitySerializer implements Serializer {
  private readonly logger = new Logger('OutboundMessageIdentitySerializer');
  serialize(value: any) {
    this.logger.debug(
      `-->> Serializing outbound message: \n${JSON.stringify(value)}`,
    );
    return value;
  }
}
