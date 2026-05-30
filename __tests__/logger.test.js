const { log, logInfo, logError, logWarn } = require('../lib/logger');

describe('Logger', () => {
  let consoleSpy;
  let output;

  beforeEach(() => {
    output = [];
    consoleSpy = jest.spyOn(console, 'log').mockImplementation((message) => {
      output.push(message);
    });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe('log function', () => {
    it('outputs JSON with timestamp, level, and message', () => {
      log('INFO', 'test message');
      expect(output.length).toBe(1);

      const logged = JSON.parse(output[0]);
      expect(logged.timestamp).toBeDefined();
      expect(logged.level).toBe('INFO');
      expect(logged.message).toBe('test message');
    });

    it('includes context fields', () => {
      log('INFO', 'test', { userId: 123, action: 'create' });
      const logged = JSON.parse(output[0]);
      expect(logged.userId).toBe(123);
      expect(logged.action).toBe('create');
    });

    it('timestamp is ISO 8601 format', () => {
      log('INFO', 'test');
      const logged = JSON.parse(output[0]);
      expect(logged.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('handles empty context', () => {
      log('ERROR', 'error message', {});
      const logged = JSON.parse(output[0]);
      expect(logged.message).toBe('error message');
    });

    it('handles context with multiple fields', () => {
      log('WARN', 'warning', { a: 1, b: 2, c: 3 });
      const logged = JSON.parse(output[0]);
      expect(logged.a).toBe(1);
      expect(logged.b).toBe(2);
      expect(logged.c).toBe(3);
    });
  });

  describe('logInfo', () => {
    it('logs with INFO level', () => {
      logInfo('info message');
      const logged = JSON.parse(output[0]);
      expect(logged.level).toBe('INFO');
      expect(logged.message).toBe('info message');
    });

    it('includes context', () => {
      logInfo('event occurred', { eventId: 'evt123' });
      const logged = JSON.parse(output[0]);
      expect(logged.eventId).toBe('evt123');
    });
  });

  describe('logError', () => {
    it('logs with ERROR level', () => {
      logError('error message');
      const logged = JSON.parse(output[0]);
      expect(logged.level).toBe('ERROR');
      expect(logged.message).toBe('error message');
    });

    it('includes error context', () => {
      logError('build failed', { code: 1, signal: 'SIGTERM' });
      const logged = JSON.parse(output[0]);
      expect(logged.code).toBe(1);
      expect(logged.signal).toBe('SIGTERM');
    });
  });

  describe('logWarn', () => {
    it('logs with WARN level', () => {
      logWarn('warning message');
      const logged = JSON.parse(output[0]);
      expect(logged.level).toBe('WARN');
      expect(logged.message).toBe('warning message');
    });

    it('includes warning context', () => {
      logWarn('deprecated', { function: 'oldFunc', replacement: 'newFunc' });
      const logged = JSON.parse(output[0]);
      expect(logged.function).toBe('oldFunc');
      expect(logged.replacement).toBe('newFunc');
    });
  });

  describe('JSON validity', () => {
    it('all outputs are valid JSON', () => {
      logInfo('message 1', { a: 1 });
      logError('message 2', { b: 2 });
      logWarn('message 3', { c: 3 });

      output.forEach((line) => {
        expect(() => JSON.parse(line)).not.toThrow();
      });
    });
  });
});
