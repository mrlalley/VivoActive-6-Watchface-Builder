// Typed error classes for structured error handling.

class ValidationError extends Error {
  constructor(message, field = null) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
  }
}

class QueueFullError extends Error {
  constructor(message = 'Queue full — try again later') {
    super(message);
    this.name = 'QueueFullError';
  }
}

class DesignNotFoundError extends Error {
  constructor(designName) {
    super(`Design not found`);
    this.name = 'DesignNotFoundError';
    this.designName = designName;
  }
}

class DesignCorruptedError extends Error {
  constructor(designName, reason = null) {
    const msg = reason ? `Design file is corrupted: ${reason}` : 'Design file is corrupted';
    super(msg);
    this.name = 'DesignCorruptedError';
    this.designName = designName;
    this.reason = reason;
  }
}

module.exports = {
  ValidationError,
  QueueFullError,
  DesignNotFoundError,
  DesignCorruptedError,
};
