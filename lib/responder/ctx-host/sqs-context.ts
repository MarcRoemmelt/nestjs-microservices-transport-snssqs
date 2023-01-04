import { BaseRpcContext } from '@nestjs/microservices/ctx-host/base-rpc.context';

type SqsContextArgs = [string, string, string] | [string];

export class SqsContext extends BaseRpcContext<SqsContextArgs> {
  constructor(args: SqsContextArgs) {
    super(args);
  }

  /**
   * Returns the pattern.
   */
  getPattern() {
    return this.args[0];
  }

  /**
   * Returns the name of the Sqs queue.
   */
  getQueue() {
    return this.args[1];
  }

  /**
   * Returns the name of the Sns topic.
   */
  getTopic() {
    return this.args[2];
  }
}
