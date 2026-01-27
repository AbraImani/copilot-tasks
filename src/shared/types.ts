/**
 * Shared types between CLI tool and Electron tray app
 */

/** Call request from CLI to tray app */
export interface CallRequest {
  callId: string;
  topic: string;
  context: string;
  questions: string[];
  timestamp: number;
}

/** Call status */
export type CallStatus = 'pending' | 'ringing' | 'active' | 'completed' | 'denied' | 'missed' | 'error';

/** Call result returned to CLI */
export interface CallResult {
  status: CallStatus;
  summary?: string;
  details?: string;
  transcript?: TranscriptEntry[];
  duration?: number;
  error?: string;
}

/** Transcript entry */
export interface TranscriptEntry {
  role: 'agent' | 'user';
  text: string;
  timestamp: number;
}

/** Call record for history */
export interface CallRecord {
  callId: string;
  topic: string;
  context: string;
  questions: string[];
  status: CallStatus;
  result?: CallResult;
  createdAt: number;
  answeredAt?: number;
  endedAt?: number;
}

/** API port */
export const API_PORT = 19741;

/** API endpoints */
export const API_ENDPOINTS = {
  CALL: '/api/call',
  QUEUE: '/api/queue', 
  HISTORY: '/api/history',
  STATUS: '/api/status',
} as const;
