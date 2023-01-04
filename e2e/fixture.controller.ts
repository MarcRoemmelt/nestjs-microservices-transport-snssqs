import { Controller } from '@nestjs/common';
import { Ctx, Payload } from '@nestjs/microservices';

import { SnsSqsEventPattern, SnsSqsMessagePattern } from '../lib/responder';

export const MESSAGE_PATTERN = 'test-message-pattern';
export const EVENT_PATTERN = 'test-event-pattern';
  
@Controller()
export class TestController {
    spy = jest.fn((...args) => args);

    @SnsSqsMessagePattern(MESSAGE_PATTERN)
    handleMessage(@Payload() payload: any, @Ctx() ctx: any) {
        return this.spy(MESSAGE_PATTERN, payload, ctx);
    }

    @SnsSqsEventPattern(EVENT_PATTERN)
    handleEvent(@Payload() payload: any, @Ctx() ctx: any) {
        this.spy(EVENT_PATTERN, payload, ctx);
    }
}
