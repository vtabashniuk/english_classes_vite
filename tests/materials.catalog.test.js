import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMaterialTags, validateMaterial } from '../src/features/materials/lib/materialValidation.js';

test('Material with description and resource is valid without tags', () => {
  assert.equal(validateMaterial({ title: 'Practice', description: 'Speaking prompts for A2', tags: [], resources: [{ title: 'Exercise', url: 'https://example.org/exercise' }] }), null);
});
test('Empty description remains invalid', () => {
  assert.equal(validateMaterial({ title: 'Practice', description: ' ', tags: [], resources: [{ title: 'Exercise', url: 'https://example.org/exercise' }] }), 'materialsFeature.validation');
});
test('Invalid external links are rejected', () => {
  assert.equal(validateMaterial({ title: 'Practice', description: 'Useful', resources: [{ title: 'Bad', url: 'javascript:alert(1)' }] }), 'materialsFeature.invalidUrl');
});
test('Legacy comma-delimited tags preserve multiword terms', () => {
  assert.deepEqual(parseMaterialTags('Past Simple, A2, past simple'), ['Past Simple', 'A2']);
});
