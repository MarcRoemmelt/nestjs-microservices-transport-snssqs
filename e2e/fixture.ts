import { INestApplication, Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { SnsSqsClient } from '../lib/requestor';
import { SnsSqsTransport } from '../lib/responder';
import { EVENT_PATTERN, MESSAGE_PATTERN, TestController } from './fixture.controller';

const options = {
    sns: {},
    sqs: {
      credentials: {
        accessKeyId: 'yourkeyid',
        secretAccessKey: 'yoursecret',
      },
      region: 'your-region',
      deadLetterQueueName: 'test-dead-letter',
    },
};

export class Fixture {
    public spy: jest.Mock;
    public client: SnsSqsClient;
    static messagePattern = MESSAGE_PATTERN;
    static eventPattern = EVENT_PATTERN;

    constructor(public readonly module: TestingModule, public readonly app: INestApplication) {}

    public async getLastReceivedPayload() {
        const controller = await this.module.resolve(TestController);
        const calls = controller.spy.mock.calls;
        const lastCall = calls.at(-1);
        return lastCall;
    } 
    public async useResponseOnce(pattern: string, response: any) {
        const controller = await this.module.resolve(TestController);
        controller.spy.mockImplementationOnce((_pattern) => {
            if (pattern === _pattern) return response;
        });
    }
    public async clearSpy() {
        const controller = await this.module.resolve(TestController);
        controller.spy.mockClear();
    }

    static async build() {
        const module = await Test.createTestingModule({
            imports: [],
            controllers: [TestController],
            providers: [
                {
                    provide: SnsSqsClient,
                    useValue: new SnsSqsClient(options),
                }
            ]
        }).compile();

        const app = module.createNestApplication();
        app.useLogger(new Logger());
        app.connectMicroservice(
        {
            strategy: new SnsSqsTransport(options),
        },
        { inheritAppConfig: true },
        );
        await app.init();
        await app.startAllMicroservices();
        const controller = await app.get(TestController);
        const fixture = new Fixture(module, app);
        fixture.client = app.get(SnsSqsClient);
        fixture.spy = controller.spy;
        return fixture;
    }
}