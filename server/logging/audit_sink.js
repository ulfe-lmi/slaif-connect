import fs from 'node:fs';
import path from 'node:path';

export class AuditSinkError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'AuditSinkError';
    this.code = code;
  }
}

export function createMemoryAuditSink() {
  const events = [];
  return {
    mode: 'memory',
    events,
    write(event) {
      events.push(event);
    },
    flush() {},
    close() {},
    healthCheck() {
      return {ok: true, mode: 'memory'};
    },
  };
}

export function createStdoutAuditSink({stream = process.stdout} = {}) {
  return {
    mode: 'stdout',
    write(event) {
      stream.write(`${JSON.stringify(event)}\n`);
    },
    flush() {},
    close() {},
    healthCheck() {
      return {ok: true, mode: 'stdout'};
    },
  };
}

export function createFileAuditSink({filePath, createParent = false} = {}) {
  if (typeof filePath !== 'string' || filePath.trim() === '') {
    throw new AuditSinkError('missing_audit_log_path', 'missing audit log path');
  }
  const resolved = path.resolve(filePath);
  const parent = path.dirname(resolved);
  if (!fs.existsSync(parent)) {
    if (!createParent) {
      throw new AuditSinkError('audit_log_parent_missing', 'audit log parent missing');
    }
    fs.mkdirSync(parent, {recursive: true, mode: 0o750});
  }
  const stream = fs.createWriteStream(resolved, {flags: 'a', mode: 0o640});
  return {
    mode: 'file',
    path: resolved,
    write(event) {
      stream.write(`${JSON.stringify(event)}\n`);
    },
    flush() {},
    close() {
      return new Promise((resolve, reject) => {
        stream.end((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
    healthCheck() {
      return {ok: !stream.destroyed, mode: 'file'};
    },
  };
}

export function createExternalAuditSink() {
  throw new AuditSinkError('audit_sink_not_implemented',
      'external audit sink is not implemented in this reference package');
}

export function createAuditSink(config = {}) {
  const mode = config.mode || config.auditLogMode || 'stdout';
  if (mode === 'memory') {
    return createMemoryAuditSink();
  }
  if (mode === 'stdout') {
    return createStdoutAuditSink(config);
  }
  if (mode === 'file') {
    return createFileAuditSink({
      filePath: config.path || config.auditLogPath,
      createParent: Boolean(config.createParent),
    });
  }
  if (mode === 'external') {
    return createExternalAuditSink();
  }
  throw new AuditSinkError('invalid_audit_sink', 'invalid audit sink');
}
