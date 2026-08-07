/** Stub @nestjs/throttler for unit tests */
const Throttle = () => () => {};
const ThrottlerModule = { forRoot: jest.fn().mockReturnValue({ module: class {} }) };
const ThrottlerGuard = class {};
module.exports = { Throttle, ThrottlerModule, ThrottlerGuard };
