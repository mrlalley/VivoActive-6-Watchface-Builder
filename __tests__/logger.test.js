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

  describe('Redaction - Pattern-based (paths and sensitive data)', () => {
    it('redacts Windows paths regardless of key name', () => {
      logInfo('preview:prg-copied', {
        from: 'C:\\Users\\mr_la\\WatchFace Builder\\build\\TestFace.prg',
        to: 'C:\\Users\\AppData\\Local\\Temp\\preview-abc\\TestFace.prg',
        requestId: 'req123'
      });
      const logged = JSON.parse(output[0]);
      expect(logged.from).toBe('***redacted***');
      expect(logged.to).toBe('***redacted***');
      expect(logged.requestId).toBe('req123'); // Short ID is preserved
    });

    it('redacts Unix paths (/, /home/, /Users/, /tmp/)', () => {
      logInfo('build:start', {
        designPath: '/home/user/designs/WatchFace.json',
        sdkPath: '/Users/admin/garmin/sdk',
        tmpPath: '/tmp/build-abc123def',
        projectName: 'MyFace'
      });
      const logged = JSON.parse(output[0]);
      expect(logged.designPath).toBe('***redacted***');
      expect(logged.sdkPath).toBe('***redacted***');
      expect(logged.tmpPath).toBe('***redacted***');
      expect(logged.projectName).toBe('MyFace'); // Short string preserved
    });

    it('redacts relative paths (./, ../, etc)', () => {
      logInfo('file-op', {
        source: './builds/project/app.prg',
        dest: '../exports/app.prg',
        status: 'success'
      });
      const logged = JSON.parse(output[0]);
      expect(logged.source).toBe('***redacted***');
      expect(logged.dest).toBe('***redacted***');
      expect(logged.status).toBe('success'); // Short string preserved
    });

    it('redacts long strings (likely base64 or sensitive data)', () => {
      logInfo('key-op', {
        privateKey: 'MIIEpAIBAAKCAQEA1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUV',
        keyName: 'dev-key-2024',
        userId: '12345'
      });
      const logged = JSON.parse(output[0]);
      expect(logged.privateKey).toBe('***redacted***');
      expect(logged.keyName).toBe('dev-key-2024'); // Short string preserved
      expect(logged.userId).toBe('12345'); // Short string preserved
    });

    it('preserves short non-path strings (requestId, status, colors)', () => {
      logInfo('render', {
        requestId: 'req-123-abc',
        elementId: 'elem_5',
        status: 'pending',
        color: '#FF00FF',
        elementCount: 42
      });
      const logged = JSON.parse(output[0]);
      expect(logged.requestId).toBe('req-123-abc');
      expect(logged.elementId).toBe('elem_5');
      expect(logged.status).toBe('pending');
      expect(logged.color).toBe('#FF00FF');
      expect(logged.elementCount).toBe(42);
    });

    it('preserves numbers and booleans', () => {
      logInfo('metrics', {
        count: 100,
        size: 1024,
        isActive: true,
        hasError: false,
        score: 3.14
      });
      const logged = JSON.parse(output[0]);
      expect(logged.count).toBe(100);
      expect(logged.size).toBe(1024);
      expect(logged.isActive).toBe(true);
      expect(logged.hasError).toBe(false);
      expect(logged.score).toBe(3.14);
    });

    it('redacts explicit sensitive keys (password, token, secret, apikey)', () => {
      logInfo('auth', {
        password: 'my-secret-password-123',
        token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
        secret: 'sk_live_abc123',
        apiKey: 'api_key_12345',
        username: 'user@example.com',
        userId: 'usr_123'
      });
      const logged = JSON.parse(output[0]);
      expect(logged.password).toBe('***redacted***');
      expect(logged.token).toBe('***redacted***');
      expect(logged.secret).toBe('***redacted***');
      expect(logged.apiKey).toBe('***redacted***');
      expect(logged.username).toBe('user@example.com'); // Not a sensitive key
      expect(logged.userId).toBe('usr_123'); // Not a sensitive key
    });

    it('recursively redacts nested objects', () => {
      logInfo('nested', {
        config: {
          sdkPath: '/Users/dev/garmin/sdk',
          apiUrl: 'https://api.garmin.com/v2'
        },
        build: {
          outputPath: 'C:\\builds\\output\\app.prg',
          status: 'success'
        },
        requestId: 'req123'
      });
      const logged = JSON.parse(output[0]);
      expect(logged.config.sdkPath).toBe('***redacted***');
      expect(logged.config.apiUrl).toBe('https://api.garmin.com/v2'); // URL is not marked as path
      expect(logged.build.outputPath).toBe('***redacted***');
      expect(logged.build.status).toBe('success');
      expect(logged.requestId).toBe('req123');
    });

    it('does not mutate the original context object', () => {
      const originalContext = {
        from: 'C:\\Users\\test\\app.prg',
        requestId: 'req123'
      };
      const contextCopy = JSON.parse(JSON.stringify(originalContext));

      logInfo('test', originalContext);

      // Original should be unchanged
      expect(originalContext).toEqual(contextCopy);
    });
  });
});
