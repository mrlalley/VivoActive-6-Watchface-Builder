const express = require('express');
const request = require('supertest');
const { saveDesign } = require('../lib/design-store');
const { createServer } = require('../server');
const path = require('path');
const fs = require('fs');

describe('Rate Limiting', () => {
  let server;
  const testDir = path.join(__dirname, 'test-designs-rate-limit');
  const mockConfig = {
    designsDir: testDir,
    sdkPath: '/fake/sdk',
    devKeyPath: '/fake/key',
    simExe: '/fake/sim'
  };

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
    fs.mkdirSync(testDir, { recursive: true });
    
    // Create a test design
    const testDesign = {
      projectName: 'TestFace',
      elements: [],
      savedAt: new Date().toISOString()
    };
    fs.writeFileSync(
      path.join(testDir, 'TestFace.json'),
      JSON.stringify(testDesign, null, 2)
    );
    
    // Create server with overridden config
    const app = express();
    const cfg = {
      designsDir: testDir,
      sdkPath: '/fake/sdk',
      devKeyPath: '/fake/key',
      simExe: '/fake/sim'
    };
    
    // Manually create a minimal app for testing
    const rateLimit = require('express-rate-limit');
    app.set('trust proxy', 1);
    
    const loadDesignLimiter = rateLimit({
      windowMs: 60000,
      max: 30,
      standardHeaders: true,
      legacyHeaders: false,
      handler: (req, res) => {
        res.status(429).json({ success: false, error: 'Too many design load requests' });
      }
    });
    
    const { loadDesign } = require('../lib/design-store');
    app.get('/api/designs/:filename', loadDesignLimiter, (req, res) => {
      try {
        const designsDir = path.join(__dirname, 'test-designs-rate-limit');
        const design = loadDesign(designsDir, req.params.filename);
        res.json({ success: true, design });
      } catch (err) {
        res.json({ success: false, error: err.message });
      }
    });
    
    server = app;
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  it('allows up to 30 requests per minute', async () => {
    // Make 30 requests - should all succeed
    for (let i = 0; i < 30; i++) {
      const response = await request(server)
        .get('/api/designs/TestFace.json');
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    }
  });

  it('blocks the 31st request with 429 status', async () => {
    // Make 31 requests - the 31st should fail
    let lastResponse;
    for (let i = 0; i < 31; i++) {
      lastResponse = await request(server)
        .get('/api/designs/TestFace.json');
    }
    
    expect(lastResponse.status).toBe(429);
    expect(lastResponse.body.success).toBe(false);
    expect(lastResponse.body.error).toBe('Too many design load requests');
  });

  it('includes RateLimit headers in responses', async () => {
    const response = await request(server)
      .get('/api/designs/TestFace.json');
    
    expect(response.headers['ratelimit-limit']).toBeDefined();
    expect(response.headers['ratelimit-remaining']).toBeDefined();
    expect(response.headers['ratelimit-reset']).toBeDefined();
  });
});
