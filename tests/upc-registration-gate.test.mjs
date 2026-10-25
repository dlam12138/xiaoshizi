import test from 'node:test';
import assert from 'node:assert/strict';
import { isRegistrationOpen, registrationUiState } from '../src/lib/registrationGate.mjs';

test('registration is open when the flag is absent', () => {
  assert.equal(isRegistrationOpen(undefined), true);
  assert.equal(isRegistrationOpen(''), true);
  assert.equal(isRegistrationOpen('true'), true);
});

test('registration closes only for an explicit false', () => {
  assert.equal(isRegistrationOpen('false'), false);
  assert.equal(isRegistrationOpen(' FALSE '), false);
  assert.equal(isRegistrationOpen('0'), true);
  assert.equal(isRegistrationOpen('no'), true);
});

test('closed gate hides the register tab and keeps login reachable', () => {
  const state = registrationUiState({ registrationOpen: false, preRelease: true });
  assert.equal(state.canRegister, false);
  assert.equal(state.showRegisterTab, false);
  assert.equal(state.fallbackMode, 'login');
  assert.match(state.banner, /注册暂未开放/);
  assert.equal(state.headerBadge, '预发布');
});

test('open gate has no regression banner', () => {
  const state = registrationUiState({ registrationOpen: true, preRelease: false });
  assert.equal(state.canRegister, true);
  assert.equal(state.banner, null);
  assert.equal(state.headerBadge, null);
});

test('public launch keeps the register tab and shows no notice', () => {
  const state = registrationUiState({ registrationOpen: true, preRelease: false });
  assert.equal(state.showRegisterTab, true);
  assert.equal(state.headerBadge, null);
  assert.equal(state.banner, null);
});

test('open registration during pre-release drops the pre-release badge', () => {
  const state = registrationUiState({ registrationOpen: true, preRelease: true });
  assert.equal(state.canRegister, true);
  assert.equal(state.headerBadge, null);
});

test('closed registration never reports an open tab', () => {
  for (const preRelease of [true, false]) {
    const state = registrationUiState({ registrationOpen: false, preRelease });
    assert.equal(state.showRegisterTab, false);
    assert.equal(state.canRegister, false);
    assert.ok(state.banner);
  }
});
