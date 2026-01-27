#!/usr/bin/env node
/**
 * Test CLI for simulating voice calls from the coding agent
 * Usage: node test-call.js
 */

const API_URL = 'http://127.0.0.1:19741';

const sampleScenario = {
  callId: `test-${Date.now()}`,
  topic: 'Database design for user authentication',
  context: `I'm building a new authentication system for a web application.

Current tech stack:
- Node.js backend with Express
- React frontend
- Planning to deploy on AWS

The user needs to decide on:
1. Which database to use for storing user credentials
2. Whether to use an ORM or raw SQL
3. Password hashing strategy

Code context:
\`\`\`typescript
// Current user model (placeholder)
interface User {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
}
\`\`\``,
  questions: [
    'Which database should we use? (PostgreSQL, MySQL, MongoDB, or other)',
    'Should we use an ORM like Prisma/TypeORM, or write raw SQL queries?',
    'Any preference for password hashing? (bcrypt, argon2, scrypt)',
  ],
};

async function checkStatus() {
  try {
    const res = await fetch(`${API_URL}/api/status`);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    return await res.json();
  } catch (e) {
    return null;
  }
}

async function makeCall(scenario) {
  const res = await fetch(`${API_URL}/api/call`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(scenario),
  });
  
  if (!res.ok) {
    throw new Error(`Call failed: ${res.status} ${await res.text()}`);
  }
  
  return await res.json();
}

async function main() {
  console.log('🧪 Voice Call Test Utility\n');
  console.log('═'.repeat(50));
  
  // Check if service is running
  console.log('\n📡 Checking service status...');
  const status = await checkStatus();
  
  if (!status) {
    console.error('❌ Service not running! Start the tray app first:');
    console.error('   npm run dev');
    process.exit(1);
  }
  
  console.log('✅ Service is running');
  console.log(`   Active call: ${status.activeCall ? status.activeCall.topic : 'None'}`);
  console.log(`   Queue length: ${status.queueLength}`);
  
  // Display scenario
  console.log('\n📋 Test Scenario:');
  console.log('─'.repeat(50));
  console.log(`Topic: ${sampleScenario.topic}`);
  console.log(`\nContext:\n${sampleScenario.context.slice(0, 200)}...`);
  console.log(`\nQuestions:`);
  sampleScenario.questions.forEach((q, i) => console.log(`  ${i + 1}. ${q}`));
  
  // Make the call
  console.log('\n' + '═'.repeat(50));
  console.log('📞 Initiating call... (check your tray app!)');
  console.log('   Waiting for response (Accept/Deny the call)...\n');
  
  try {
    const result = await makeCall(sampleScenario);
    
    console.log('═'.repeat(50));
    console.log('📱 Call Result:');
    console.log('─'.repeat(50));
    console.log(`Status: ${result.status}`);
    
    if (result.status === 'denied') {
      console.log('\n🚫 Call was denied by user');
    } else if (result.status === 'completed') {
      console.log(`\n✅ Call completed!`);
      if (result.summary) {
        console.log(`\nSummary:\n${result.summary}`);
      }
      if (result.duration) {
        console.log(`\nDuration: ${result.duration} seconds`);
      }
      if (result.transcript && result.transcript.length > 0) {
        console.log(`\nTranscript:`);
        result.transcript.forEach(t => {
          const icon = t.role === 'agent' ? '🤖' : '👤';
          console.log(`  ${icon} ${t.text}`);
        });
      }
    } else if (result.status === 'error') {
      console.log(`\n❌ Error: ${result.error}`);
    }
    
    console.log('\n' + '═'.repeat(50));
    console.log('Test complete!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();
