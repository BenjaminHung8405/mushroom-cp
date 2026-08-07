/**
 * Lightweight redis mock for Jest unit tests.
 * Stubs out the createClient API so AuthService instantiates without errors.
 */
function createClient(_opts) {
  return {
    on: jest.fn(),
    connect: jest.fn().mockResolvedValue(undefined),
    quit: jest.fn().mockResolvedValue(undefined),
    isOpen: false,
    duplicate: jest.fn().mockReturnThis(),
    subscribe: jest.fn().mockResolvedValue(undefined),
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
    publish: jest.fn().mockResolvedValue(0),
  };
}

module.exports = { createClient };
