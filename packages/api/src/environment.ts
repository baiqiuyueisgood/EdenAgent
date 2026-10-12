import { z } from 'zod'

const text = z.string().max(500).default('')
const locationTimestamp = z.iso.datetime({ offset: true })
export const sessionEnvironmentSchema = z.object({
  timezone: text, locale: text,
  location: z.object({ country: text, region: text, city: text, district: text,
    latitude: z.number().min(-90).max(90).nullish(), longitude: z.number().min(-180).max(180).nullish(),
    source: z.string().max(500).nullish(), updated_at: z.string().max(500).nullish(),
    accuracy: z.number().nonnegative().nullish(),
  }).optional(),
}).nullable()

// Keep location provenance in model context; coordinates stay in host storage.
export function modelEnvironment(value: unknown) {
  const parsed = sessionEnvironmentSchema.safeParse(value)
  if (!parsed.success || !parsed.data) return null
  const { timezone, locale, location } = parsed.data
  const updatedAt = locationTimestamp.safeParse(location?.updated_at)
  return { timezone, locale, ...(location ? { location: {
    country: location.country, region: location.region, city: location.city, district: location.district,
    source: location.source?.trim() || null,
    updated_at: updatedAt.success ? updatedAt.data : null,
    accuracy: location.accuracy ?? null,
  } } : {}) }
}
