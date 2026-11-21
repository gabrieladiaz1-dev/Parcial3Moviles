export function institutionMapUrl(info: { latitude: number | null; longitude: number | null; address: string | null } | null): string | null {
  if (!info) return null
  const coordinate = info.latitude !== null && info.longitude !== null && Number.isFinite(Number(info.latitude)) && Number.isFinite(Number(info.longitude)) && Math.abs(Number(info.latitude)) <= 90 && Math.abs(Number(info.longitude)) <= 180
  const query = coordinate ? `${info.latitude},${info.longitude}` : info.address?.trim()
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : null
}
