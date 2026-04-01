/**
 * 共享 TypeBox Schema 片段
 * 多个工具复用的时间参数 schema
 */

import { Type } from '@mariozechner/pi-ai'

export const timeParamProperties = {
  year: Type.Optional(Type.Number({ description: 'ai.tools._shared.params.year' })),
  month: Type.Optional(Type.Number({ description: 'ai.tools._shared.params.month' })),
  day: Type.Optional(Type.Number({ description: 'ai.tools._shared.params.day' })),
  hour: Type.Optional(Type.Number({ description: 'ai.tools._shared.params.hour' })),
  start_time: Type.Optional(Type.String({ description: 'ai.tools._shared.params.start_time' })),
  end_time: Type.Optional(Type.String({ description: 'ai.tools._shared.params.end_time' })),
}

export const timeParamPropertiesNoHour = {
  year: Type.Optional(Type.Number({ description: 'ai.tools._shared.params.year' })),
  month: Type.Optional(Type.Number({ description: 'ai.tools._shared.params.month' })),
  day: Type.Optional(Type.Number({ description: 'ai.tools._shared.params.day' })),
  start_time: Type.Optional(Type.String({ description: 'ai.tools._shared.params.start_time' })),
  end_time: Type.Optional(Type.String({ description: 'ai.tools._shared.params.end_time' })),
}
