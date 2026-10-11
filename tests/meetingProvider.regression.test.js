import assert from 'node:assert/strict';
import test from 'node:test';

import { detectMeetingProvider } from '../src/features/lessons/lib/meetingProvider.js';

test('meeting links: trusted provider URLs are recognized without storing a provider-specific field', () => {
  assert.equal(detectMeetingProvider('https://zoom.us/j/123'), 'zoom');
  assert.equal(detectMeetingProvider('https://us05web.zoom.us/j/123'), 'zoom');
  assert.equal(detectMeetingProvider('https://meet.google.com/abc-defg-hij'), 'googleMeet');
  assert.equal(detectMeetingProvider('https://teams.microsoft.com/l/meetup-join/x'), 'microsoftTeams');
  assert.equal(detectMeetingProvider('https://teams.live.com/meet/123'), 'microsoftTeams');
});

test('meeting links: spoofed provider-like domains are not trusted as official providers', () => {
  assert.equal(detectMeetingProvider('https://zoom.us.attacker.test/j/123'), 'generic');
  assert.equal(detectMeetingProvider('https://fake-meet.google.com.attacker.test/a'), 'generic');
  assert.equal(detectMeetingProvider('https://evilteams.microsoft.com.attacker.test/a'), 'generic');
  assert.equal(detectMeetingProvider('https://example.org/video'), 'generic');
  assert.equal(detectMeetingProvider('not a url'), 'generic');
  assert.equal(detectMeetingProvider(''), 'generic');
});
