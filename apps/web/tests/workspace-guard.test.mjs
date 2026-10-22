import test from 'node:test'
import assert from 'node:assert/strict'

const { isNavigationBlocked } = await import('../src/workbench/state/workspaceGuard.ts')

const documents = [
  { page: 'parameters', unsaved: true },
  { page: 'analysis', unsaved: false },
]

test('unsaved active document blocks switching, but same-page commands remain allowed', () => {
  assert.equal(isNavigationBlocked(documents, 'parameters', 'analysis'), true)
  assert.equal(isNavigationBlocked(documents, 'parameters', 'parameters'), false)
})

test('saved or unknown active documents do not block navigation', () => {
  assert.equal(isNavigationBlocked(documents, 'analysis', 'runs'), false)
  assert.equal(isNavigationBlocked(documents, 'missing', 'runs'), false)
})
