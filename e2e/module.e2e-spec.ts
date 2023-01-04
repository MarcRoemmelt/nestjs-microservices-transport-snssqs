import { firstValueFrom } from 'rxjs';
import { promisify } from 'util';

import { Fixture } from './fixture';

const delay = promisify(setTimeout);
jest.setTimeout(15000);

describe('SnsSqsTransport', () => {
  let fixture: Fixture;

  beforeAll(async () => {
    fixture = await Fixture.build();
  });

  afterAll(async () => {
    if (!fixture) return;
    await fixture.app.close();
  })

  describe('startUp', () => {
    it('should start application', async () => {
      expect(fixture.app).toBeDefined();
    });
  });

  describe('message handling', () => {
    it('should send message & receive response', async () => {
      const response = true;
      fixture.useResponseOnce(Fixture.messagePattern, response);
      const result = await firstValueFrom(fixture.client.send(Fixture.messagePattern, { someData: 22 }));
      expect(result).toEqual(response);
    });

    it('should handle multiple messages', async () => {
      await fixture.clearSpy();

      const numMessages = 10;

      const sendMessage = (index: number) => {
        const payload = { payload: index };
        const subscription = fixture.client.send(Fixture.messagePattern, payload);
        return { subscription, payload };
      };
      const tests = Array(numMessages).fill(null).map((_, i) => sendMessage(i));

      await delay(2000);

      await Promise.all(tests.map((test) => firstValueFrom(test.subscription)));

      const allPayloads = fixture.spy.mock.calls.map((callArgs) => callArgs.at(1));
      for (const test of tests) {
        expect(allPayloads).toContainEqual(test.payload);
      }
    });
  });

  describe('event handling', () => {
    it('should publish & receive event correctly', async () => {
      const payload = { someData: 33 };
      fixture.client.emit(Fixture.eventPattern, payload);
      await delay(3000);
      const [pattern, lastPayload] = await fixture.getLastReceivedPayload();
      expect(pattern).toEqual(Fixture.eventPattern);
      expect(lastPayload).toEqual(payload);
    });

    it('should handle multiple events', async () => {
      await fixture.clearSpy();

      const numEvents = 10;

      const emitEvent = (index: number) => {
        const payload = { payload: index };
        const subscription = fixture.client.emit(Fixture.eventPattern, payload);
        return { subscription, payload };
      };
      const tests = Array(numEvents).fill(null).map((_, i) => emitEvent(i));

      await delay(8000);

      const allPayloads = fixture.spy.mock.calls.map((callArgs) => callArgs.at(1));
      for (const test of tests) {
        expect(allPayloads).toContainEqual(test.payload);
      }
    });
  });
});
