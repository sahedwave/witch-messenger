const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;

export const prayerLocationPresets = [
  { id: "dhaka", label: "Dhaka", country: "Bangladesh", timeZone: "Asia/Dhaka", latitude: 23.8103, longitude: 90.4125 },
  { id: "chattogram", label: "Chattogram", country: "Bangladesh", timeZone: "Asia/Dhaka", latitude: 22.3569, longitude: 91.7832 },
  { id: "rajshahi", label: "Rajshahi", country: "Bangladesh", timeZone: "Asia/Dhaka", latitude: 24.3745, longitude: 88.6042 },
  { id: "khulna", label: "Khulna", country: "Bangladesh", timeZone: "Asia/Dhaka", latitude: 22.8456, longitude: 89.5403 },
  { id: "barishal", label: "Barishal", country: "Bangladesh", timeZone: "Asia/Dhaka", latitude: 22.701, longitude: 90.3535 },
  { id: "sylhet", label: "Sylhet", country: "Bangladesh", timeZone: "Asia/Dhaka", latitude: 24.8949, longitude: 91.8687 },
  { id: "rangpur", label: "Rangpur", country: "Bangladesh", timeZone: "Asia/Dhaka", latitude: 25.7439, longitude: 89.2752 },
  { id: "mymensingh", label: "Mymensingh", country: "Bangladesh", timeZone: "Asia/Dhaka", latitude: 24.7471, longitude: 90.4203 },
  { id: "makkah", label: "Makkah", country: "Saudi Arabia", timeZone: "Asia/Riyadh", latitude: 21.3891, longitude: 39.8579 },
  { id: "madinah", label: "Madinah", country: "Saudi Arabia", timeZone: "Asia/Riyadh", latitude: 24.5247, longitude: 39.5692 },
  { id: "istanbul", label: "Istanbul", country: "Turkey", timeZone: "Europe/Istanbul", latitude: 41.0082, longitude: 28.9784 },
  { id: "cairo", label: "Cairo", country: "Egypt", timeZone: "Africa/Cairo", latitude: 30.0444, longitude: 31.2357 },
  { id: "karachi", label: "Karachi", country: "Pakistan", timeZone: "Asia/Karachi", latitude: 24.8607, longitude: 67.0011 },
  { id: "jakarta", label: "Jakarta", country: "Indonesia", timeZone: "Asia/Jakarta", latitude: -6.2088, longitude: 106.8456 },
  { id: "kuala-lumpur", label: "Kuala Lumpur", country: "Malaysia", timeZone: "Asia/Kuala_Lumpur", latitude: 3.139, longitude: 101.6869 },
  { id: "london", label: "London", country: "United Kingdom", timeZone: "Europe/London", latitude: 51.5072, longitude: -0.1276 },
  { id: "new-york", label: "New York", country: "United States", timeZone: "America/New_York", latitude: 40.7128, longitude: -74.006 },
  { id: "toronto", label: "Toronto", country: "Canada", timeZone: "America/Toronto", latitude: 43.6532, longitude: -79.3832 },
  { id: "sydney", label: "Sydney", country: "Australia", timeZone: "Australia/Sydney", latitude: -33.8688, longitude: 151.2093 }
];

function normalizeHour(hour) {
  return ((hour % 24) + 24) % 24;
}

function hoursToTimeString(hours) {
  const normalized = normalizeHour(hours);
  const totalMinutes = Math.round(normalized * 60);
  const hh = String(Math.floor(totalMinutes / 60) % 24).padStart(2, "0");
  const mm = String(totalMinutes % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function dayOfYear(date) {
  const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 0));
  return Math.floor((date - start) / 86400000);
}

function getTimeZoneOffsetMinutes(timeZone, date) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );

  return (asUtc - date.getTime()) / 60000;
}

function solarDeclination(day) {
  return 23.45 * Math.sin(DEG_TO_RAD * ((360 / 365) * (day - 81)));
}

function equationOfTime(day) {
  const b = DEG_TO_RAD * ((360 / 365) * (day - 81));
  return 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
}

function hourAngleForSolarAltitude(latitude, declination, altitude) {
  const latRad = latitude * DEG_TO_RAD;
  const decRad = declination * DEG_TO_RAD;
  const altRad = altitude * DEG_TO_RAD;
  const numerator = Math.sin(altRad) - Math.sin(latRad) * Math.sin(decRad);
  const denominator = Math.cos(latRad) * Math.cos(decRad);
  const ratio = clamp(numerator / denominator, -1, 1);
  return Math.acos(ratio) * RAD_TO_DEG;
}

function hourAngleForAsr(latitude, declination) {
  const latRad = latitude * DEG_TO_RAD;
  const decRad = declination * DEG_TO_RAD;
  const shadowAngle = Math.atan(1 / (1 + Math.tan(Math.abs(latRad - decRad))));
  const numerator = Math.sin(shadowAngle) - Math.sin(latRad) * Math.sin(decRad);
  const denominator = Math.cos(latRad) * Math.cos(decRad);
  const ratio = clamp(numerator / denominator, -1, 1);
  return Math.acos(ratio) * RAD_TO_DEG;
}

export function calculatePrayerTimes({
  latitude,
  longitude,
  timeZone,
  date = new Date()
}) {
  const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0));
  const zoneOffsetHours = getTimeZoneOffsetMinutes(timeZone, utcDate) / 60;
  const day = dayOfYear(utcDate);
  const declination = solarDeclination(day);
  const equationMinutes = equationOfTime(day);

  const solarNoon = 12 + zoneOffsetHours - longitude / 15 - equationMinutes / 60;
  const sunriseHourAngle = hourAngleForSolarAltitude(latitude, declination, -0.833);
  const fajrHourAngle = hourAngleForSolarAltitude(latitude, declination, -18);
  const ishaHourAngle = fajrHourAngle;
  const asrHourAngle = hourAngleForAsr(latitude, declination);

  const fajr = solarNoon - fajrHourAngle / 15;
  const sunrise = solarNoon - sunriseHourAngle / 15;
  const dhuhr = solarNoon + 0.08;
  const asr = solarNoon + asrHourAngle / 15;
  const maghrib = solarNoon + sunriseHourAngle / 15;
  const isha = solarNoon + ishaHourAngle / 15;

  return {
    sehri: hoursToTimeString(fajr - 0.75),
    fajr: hoursToTimeString(fajr),
    sunrise: hoursToTimeString(sunrise),
    dhuhr: hoursToTimeString(dhuhr),
    asr: hoursToTimeString(asr),
    maghrib: hoursToTimeString(maghrib),
    iftar: hoursToTimeString(maghrib),
    isha: hoursToTimeString(isha),
    taraweeh: hoursToTimeString(isha + 0.75)
  };
}

export function detectPrayerPreset() {
  const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    prayerLocationPresets.find((preset) => preset.timeZone === browserTimeZone) ||
    prayerLocationPresets.find((preset) => preset.id === "dhaka") ||
    prayerLocationPresets[0]
  );
}
