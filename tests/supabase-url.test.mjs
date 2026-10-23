import test from 'node:test';
import assert from 'node:assert/strict';
import { hasAllowedSupabaseProtocol } from '../src/lib/supabaseUrl.mjs';

test('Supabase allows HTTPS projects and HTTP loopback development stacks', () => {
  for (const raw of [
    'https://test-project.supabase.co',
    'http://localhost:54321',
    'http://127.0.0.1:54321',
    'http://[::1]:54321',
  ]) assert.equal(hasAllowedSupabaseProtocol(new URL(raw)), true, raw);
});

test('Supabase refuses insecure remote and lookalike loopback addresses', () => {
  for (const raw of [
    'http://test-project.supabase.co',
    'http://localhost.example.com:54321',
    'http://127.0.0.1.example.com:54321',
    'http://192.168.1.1:54321',
    'http://0.0.0.0:54321',
    'ftp://localhost:54321',
  ]) assert.equal(hasAllowedSupabaseProtocol(new URL(raw)), false, raw);
});
