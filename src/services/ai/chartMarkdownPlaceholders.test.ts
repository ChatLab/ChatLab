import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { stripChartImagePlaceholders } from './chartMarkdownPlaceholders'

describe('stripChartImagePlaceholders', () => {
  it('removes generated chart image placeholders while keeping surrounding text', () => {
    const result = stripChartImagePlaceholders(`## 月度消息量趋势

![月度消息量趋势](chart1.png)
![阅读消息量分布](chart2.png)

下面是趋势分析。`)

    assert.equal(result, '## 月度消息量趋势\n\n下面是趋势分析。')
  })

  it('keeps non-chart markdown images', () => {
    const input = '![真实截图](screenshots/report.png)'

    assert.equal(stripChartImagePlaceholders(input), input)
  })
})
