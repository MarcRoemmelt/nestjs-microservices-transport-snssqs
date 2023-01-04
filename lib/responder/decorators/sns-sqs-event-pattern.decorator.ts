import { EventPattern, Transport } from '@nestjs/microservices';

import { CONTROLLER_NAME, HANDLER_NAME } from '../../constants';

export function SnsSqsEventPattern<T = string>(metadata?: T): MethodDecorator;
export function SnsSqsEventPattern<T = string>(metadata?: T, transport?: Transport | symbol): MethodDecorator;
export function SnsSqsEventPattern<T = string>(metadata?: T, extras?: Record<string, any>): MethodDecorator;
export function SnsSqsEventPattern<T = string>(
  metadata?: T,
  transport?: Transport | symbol,
  extras?: Record<string, any>,
): MethodDecorator;
export function SnsSqsEventPattern<T = string>(
  metadata?: T,
  transportOrExtras?: Transport | symbol | Record<string, any>,
  maybeExtras?: Record<string, any>,
) {

  return (targetPrototype: unknown, key: string, descriptor: PropertyDescriptor) => {
    const controllerName = targetPrototype?.constructor?.name;
    const handlerName = descriptor.value.name;

    const extras = (hasTransport(transportOrExtras) ? maybeExtras : transportOrExtras) ?? {};
    const extendedExtras = Object.assign(extras, { [CONTROLLER_NAME]: controllerName, [HANDLER_NAME]: handlerName });

    const eventPatternDecorator = hasTransport(transportOrExtras)
        ? EventPattern(metadata, transportOrExtras, extendedExtras)
        : EventPattern(metadata, extendedExtras);

    eventPatternDecorator(targetPrototype, key, descriptor);
  };
}

const hasTransport = (
  transportOrExtras?: Transport | symbol | Record<string, any>,
): transportOrExtras is Transport | symbol => {
  return typeof transportOrExtras === 'symbol' || typeof transportOrExtras === 'number';
};
