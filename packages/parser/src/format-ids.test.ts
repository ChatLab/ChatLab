import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  getFormatFeatureById,
  getSupportedFormats,
  LEGACY_PARSER_FORMAT_ID_ALIASES,
  normalizeParserFormatId,
} from './index'

describe('parser format ID compatibility', () => {
  it('advertises canonical IDs while resolving every released legacy input alias', () => {
    const supportedIds = new Set<string>(getSupportedFormats().map((format) => format.id))

    for (const [legacyId, canonicalId] of Object.entries(LEGACY_PARSER_FORMAT_ID_ALIASES)) {
      assert.equal(normalizeParserFormatId(legacyId), canonicalId)
      assert.equal(getFormatFeatureById(legacyId)?.id, canonicalId)
      assert.equal(supportedIds.has(canonicalId), true)
      assert.equal(supportedIds.has(legacyId), false)
    }
  })

  it('leaves unknown IDs unchanged so callers can reject them normally', () => {
    assert.equal(normalizeParserFormatId('future-format'), 'future-format')
    assert.equal(getFormatFeatureById('future-format'), null)
  })
})
