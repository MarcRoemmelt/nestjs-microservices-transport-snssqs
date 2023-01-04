import type { Serializer, Deserializer } from '@nestjs/microservices';

import { SqsOptions } from '../sqs-client/sqs.types';

export interface SnsSqsOptions {
  name?: string;

  sqs: SqsOptions;

  /**
   * instance of a class implementing the serialize method
   */
  serializer?: Serializer;
  /**
   * instance of a class implementing the deserialize method
   */
  deserializer?: Deserializer;
}
