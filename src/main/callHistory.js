/**
 * Call History Database using better-sqlite3
 */
const Database = require('better-sqlite3');
const path = require('path');
const { app } = require('electron');

class CallHistoryDB {
  constructor() {
    const userDataPath = app.getPath('userData');
    const dbPath = path.join(userDataPath, 'call-history.db');
    
    this.db = new Database(dbPath);
    this.initialize();
  }

  initialize() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        call_id TEXT UNIQUE NOT NULL,
        topic TEXT NOT NULL,
        context TEXT,
        questions TEXT,
        status TEXT NOT NULL,
        result_summary TEXT,
        result_details TEXT,
        result_transcript TEXT,
        duration INTEGER,
        error TEXT,
        created_at INTEGER NOT NULL,
        answered_at INTEGER,
        ended_at INTEGER
      );
      
      CREATE INDEX IF NOT EXISTS idx_calls_created_at ON calls(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_calls_status ON calls(status);
    `);
  }

  saveCall(callRecord) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO calls (
        call_id, topic, context, questions, status,
        result_summary, result_details, result_transcript, duration, error,
        created_at, answered_at, ended_at
      ) VALUES (
        @callId, @topic, @context, @questions, @status,
        @resultSummary, @resultDetails, @resultTranscript, @duration, @error,
        @createdAt, @answeredAt, @endedAt
      )
    `);

    stmt.run({
      callId: callRecord.callId,
      topic: callRecord.topic,
      context: callRecord.context || null,
      questions: callRecord.questions ? JSON.stringify(callRecord.questions) : null,
      status: callRecord.status,
      resultSummary: callRecord.result?.summary || null,
      resultDetails: callRecord.result?.details || null,
      resultTranscript: callRecord.result?.transcript ? JSON.stringify(callRecord.result.transcript) : null,
      duration: callRecord.result?.duration || null,
      error: callRecord.result?.error || callRecord.error || null,
      createdAt: callRecord.createdAt || callRecord.timestamp || Date.now(),
      answeredAt: callRecord.answeredAt || null,
      endedAt: callRecord.endedAt || null,
    });
  }

  getHistory(limit = 50) {
    const stmt = this.db.prepare(`
      SELECT * FROM calls 
      ORDER BY created_at DESC 
      LIMIT ?
    `);

    const rows = stmt.all(limit);
    return rows.map(row => ({
      callId: row.call_id,
      topic: row.topic,
      context: row.context,
      questions: row.questions ? JSON.parse(row.questions) : [],
      status: row.status,
      result: row.result_summary ? {
        summary: row.result_summary,
        details: row.result_details,
        transcript: row.result_transcript ? JSON.parse(row.result_transcript) : [],
        duration: row.duration,
      } : null,
      error: row.error,
      createdAt: row.created_at,
      answeredAt: row.answered_at,
      endedAt: row.ended_at,
    }));
  }

  getCall(callId) {
    const stmt = this.db.prepare('SELECT * FROM calls WHERE call_id = ?');
    const row = stmt.get(callId);
    
    if (!row) return null;
    
    return {
      callId: row.call_id,
      topic: row.topic,
      context: row.context,
      questions: row.questions ? JSON.parse(row.questions) : [],
      status: row.status,
      result: row.result_summary ? {
        summary: row.result_summary,
        details: row.result_details,
        transcript: row.result_transcript ? JSON.parse(row.result_transcript) : [],
        duration: row.duration,
      } : null,
      error: row.error,
      createdAt: row.created_at,
      answeredAt: row.answered_at,
      endedAt: row.ended_at,
    };
  }

  clearHistory() {
    this.db.exec('DELETE FROM calls');
  }

  close() {
    this.db.close();
  }
}

module.exports = { CallHistoryDB };
