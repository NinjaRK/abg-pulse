import test from 'node:test';
import assert from 'node:assert/strict';
import {
  editorialActor,
  isEditorialAuthorised,
  suppliedEditorialToken
} from '../api/corrections.js';

test('editorial bearer and dedicated headers are parsed conservatively', () => {
  assert.equal(suppliedEditorialToken({ headers: { authorization: 'Bearer editorial-secret' } }), 'editorial-secret');
  assert.equal(suppliedEditorialToken({ headers: { 'x-editorial-secret': 'header-secret' } }), 'header-secret');
  assert.equal(suppliedEditorialToken({ headers: { 'x-ingest-secret': 'fallback-secret' } }), 'fallback-secret');
  assert.equal(suppliedEditorialToken({ headers: {} }), '');
});

test('editorial authorisation prefers EDITORIAL_SECRET and rejects empty secrets', () => {
  const env = { EDITORIAL_SECRET: 'editorial-secret', INGEST_SECRET: 'ingest-secret' };
  assert.equal(isEditorialAuthorised({ headers: { authorization: 'Bearer editorial-secret' } }, env), true);
  assert.equal(isEditorialAuthorised({ headers: { authorization: 'Bearer ingest-secret' } }, env), false);
  assert.equal(isEditorialAuthorised({ headers: { authorization: 'Bearer anything' } }, {}), false);
});

test('INGEST_SECRET is a deliberate fallback only when editorial secret is absent', () => {
  const env = { INGEST_SECRET: 'ingest-secret' };
  assert.equal(isEditorialAuthorised({ headers: { 'x-ingest-secret': 'ingest-secret' } }, env), true);
  assert.equal(isEditorialAuthorised({ headers: { 'x-ingest-secret': 'wrong' } }, env), false);
});

test('accountable editor identifier comes from the protected header before body input', () => {
  assert.equal(editorialActor({ headers: { 'x-editor-id': 'editor-header' } }, { actor: 'editor-body' }), 'editor-header');
  assert.equal(editorialActor({ headers: {} }, { actor: 'editor-body' }), 'editor-body');
});

test('missing or oversized editor identifiers fail closed', () => {
  assert.throws(() => editorialActor({ headers: {} }, {}), (error) => error.code === 'editor_required' && error.status === 400);
  assert.throws(() => editorialActor({ headers: { 'x-editor-id': 'x'.repeat(201) } }, {}), (error) => error.code === 'editor_invalid');
});
