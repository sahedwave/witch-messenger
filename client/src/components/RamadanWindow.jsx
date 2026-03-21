import { useEffect, useMemo, useState } from "react";

import { api } from "../api";
import { quranSurahs } from "../quran-data";
import { calculatePrayerTimes, detectPrayerPreset, prayerLocationPresets } from "../ramadan-utils";

const RAMADAN_STORAGE_KEY = "witch-ramadan-app-state";

const translationAssetMap = {
  "en.asad": "/quran/en-asad.json",
  "en.sahih": "/quran/en-sahih.json",
  "bn.bengali": "/quran/bn-bengali.json"
};

const quranAssetCache = new Map();

const defaultPrayerTimes = {
  sehri: "04:15",
  fajr: "04:32",
  sunrise: "05:48",
  dhuhr: "12:10",
  asr: "15:42",
  maghrib: "18:15",
  iftar: "18:15",
  isha: "19:32",
  taraweeh: "20:15"
};

const dailyAyahPrompts = [
  "Start with Surah Al-Fatihah and reflect on seeking guidance daily.",
  "Read Surah Al-Baqarah 2:183 and connect fasting with taqwa.",
  "Reflect on mercy and patience through Surah Az-Zumar 39:53.",
  "Read Surah Al-Qadr and think about the value of a single night.",
  "Return to Surah Ar-Rahman and count blessings consciously.",
  "Read Surah Al-Mulk before sleep and renew accountability.",
  "Reflect on Surah Ad-Duha and hope after difficulty.",
  "Read Surah Al-Inshirah and connect it to Ramadan resilience.",
  "Pause on Surah Al-Ikhlas and refresh intention.",
  "Read Surah Al-Hashr 59:18 and review your day with honesty."
];

const dailyDuaPrompts = [
  "Allahumma innaka afuwwun tuhibbul afwa fa'fu anni.",
  "Rabbi zidni ilma wa nafi'ni bima allamtani.",
  "Rabbana taqabbal minna innaka anta as-sami'ul alim.",
  "Allahumma a'inni ala dhikrika wa shukrika wa husni ibadatik.",
  "Rabbi yassir wa la tu'assir wa tammim bil khair.",
  "Hasbunallahu wa ni'mal wakeel.",
  "Rabbi inni lima anzalta ilayya min khairin faqir.",
  "Allahumma inni as'aluka al-huda wat-tuqa wal-afaf wal-ghina.",
  "Rabbighfir li wa liwalidayya wa lilmu'minina yawma yaqumul hisab.",
  "Allahumma balighna laylat al-qadr وارزقنا فيها القبول."
];

function readStoredRamadanState() {
  try {
    const raw = window.localStorage.getItem(RAMADAN_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function createDefaultRamadanState() {
  const preset = detectPrayerPreset();

  return {
    ramadanDay: 1,
    prayerTimes: calculatePrayerTimes({
      latitude: preset.latitude,
      longitude: preset.longitude,
      timeZone: preset.timeZone
    }),
    prayerSetup: {
      presetId: preset.id,
      method: "preset",
      timeZone: preset.timeZone,
      label: `${preset.label}, ${preset.country}`,
      lastCalculatedAt: new Date().toISOString()
    },
    remindersEnabled: false,
    reminderLeadMinutes: 15,
    completedFasts: [],
    prayerChecks: [],
    quranProgress: {
      currentJuz: 1,
      completedJuzs: 0,
      note: ""
    },
    taraweehNights: [],
    charityGoal: "",
    charityEntries: [],
    journalEntries: []
  };
}

function normalizeRamadanState(state) {
  const defaults = createDefaultRamadanState();
  if (!state) {
    return defaults;
  }

  return {
    ...defaults,
    ...state,
    prayerTimes: {
      ...defaults.prayerTimes,
      ...(state.prayerTimes || {})
    },
    prayerSetup: {
      ...defaults.prayerSetup,
      ...(state.prayerSetup || {})
    },
    quranProgress: {
      ...defaults.quranProgress,
      ...(state.quranProgress || {})
    },
    completedFasts: state.completedFasts || [],
    prayerChecks: state.prayerChecks || [],
    taraweehNights: state.taraweehNights || [],
    charityEntries: state.charityEntries || [],
    journalEntries: state.journalEntries || []
  };
}

function readClientDataset(assetPath) {
  if (quranAssetCache.has(assetPath)) {
    return Promise.resolve(quranAssetCache.get(assetPath));
  }

  return fetch(assetPath).then((response) => {
    if (!response.ok) {
      throw new Error("Unable to load local Quran dataset.");
    }

    return response.json().then((payload) => {
      quranAssetCache.set(assetPath, payload);
      return payload;
    });
  });
}

async function loadSurahFromClientAssets(surahNumber, translation) {
  const [arabicDataset, translationDataset] = await Promise.all([
    readClientDataset("/quran/quran-uthmani.json"),
    readClientDataset(translationAssetMap[translation] || "/quran/en-asad.json")
  ]);
  const arabicSurah = arabicDataset?.data?.surahs?.[surahNumber - 1];
  const translatedSurah = translationDataset?.data?.surahs?.[surahNumber - 1];
  const arabicAyahs = Array.isArray(arabicSurah?.ayahs) ? arabicSurah.ayahs : [];
  const translatedAyahs = Array.isArray(translatedSurah?.ayahs) ? translatedSurah.ayahs : [];

  return arabicAyahs.map((ayah, index) => ({
    numberInSurah: ayah.numberInSurah,
    arabicText: ayah.text,
    translationText: translatedAyahs[index]?.text || "",
    juz: ayah.juz,
    page: ayah.page
  }));
}

function QuranStat({ label, value }) {
  return (
    <div className="quran-window-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function parseTimeToDate(time) {
  const [hours, minutes] = String(time || "00:00").split(":").map((value) => Number.parseInt(value, 10) || 0);
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date;
}

function formatTimeLabel(time) {
  const date = parseTimeToDate(time);
  return new Intl.DateTimeFormat([], {
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).format(date);
}

function formatCurrency(value) {
  const amount = Number.parseFloat(value || 0);
  if (Number.isNaN(amount)) {
    return "0";
  }

  return new Intl.NumberFormat().format(amount);
}

function RamadanOverviewCard({ title, body, accent }) {
  return (
    <article className={`ramadan-window-card ${accent ? `is-${accent}` : ""}`}>
      <strong>{title}</strong>
      <p>{body}</p>
    </article>
  );
}

export function RamadanWindow() {
  const [activeTab, setActiveTab] = useState("overview");
  const [search, setSearch] = useState("");
  const [selectedSurahNumber, setSelectedSurahNumber] = useState(1);
  const [selectedTranslation, setSelectedTranslation] = useState("en.asad");
  const [surahReaderState, setSurahReaderState] = useState({
    loading: true,
    error: "",
    verses: []
  });
  const [journalDraft, setJournalDraft] = useState("");
  const [charityDraft, setCharityDraft] = useState({ title: "", amount: "" });
  const [ramadanState, setRamadanState] = useState(() => normalizeRamadanState(readStoredRamadanState()));
  const [privacyMessage, setPrivacyMessage] = useState("");

  const filteredSurahs = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    if (!normalized) {
      return quranSurahs;
    }

    return quranSurahs.filter(
      (surah) =>
        surah.name.toLowerCase().includes(normalized) ||
        surah.arabicName.includes(search.trim()) ||
        String(surah.number).includes(normalized)
    );
  }, [search]);

  const selectedSurah =
    quranSurahs.find((surah) => surah.number === selectedSurahNumber) || quranSurahs[0];

  const completedFasts = ramadanState.completedFasts || [];
  const taraweehNights = ramadanState.taraweehNights || [];
  const charityEntries = ramadanState.charityEntries || [];
  const journalEntries = ramadanState.journalEntries || [];

  const dailyAyah = dailyAyahPrompts[(ramadanState.ramadanDay - 1) % dailyAyahPrompts.length];
  const dailyDua = dailyDuaPrompts[(ramadanState.ramadanDay - 1) % dailyDuaPrompts.length];

  const totalDonated = charityEntries.reduce(
    (sum, entry) => sum + (Number.parseFloat(entry.amount) || 0),
    0
  );
  const charityGoalValue = Number.parseFloat(ramadanState.charityGoal) || 0;
  const donationProgress = charityGoalValue ? Math.min(100, Math.round((totalDonated / charityGoalValue) * 100)) : 0;

  const nextReminder = useMemo(() => {
    if (!ramadanState.remindersEnabled) {
      return null;
    }

    const leadMinutes = Number.parseInt(ramadanState.reminderLeadMinutes, 10) || 0;
    const checkpoints = [
      { id: "sehri", label: "Suhoor reminder", time: ramadanState.prayerTimes.sehri },
      { id: "maghrib", label: "Iftar reminder", time: ramadanState.prayerTimes.maghrib }
    ]
      .map((item) => {
        const date = parseTimeToDate(item.time);
        date.setMinutes(date.getMinutes() - leadMinutes);
        return { ...item, date };
      })
      .filter((item) => item.date.getTime() > Date.now())
      .sort((first, second) => first.date - second.date);

    return checkpoints[0] || null;
  }, [ramadanState.prayerTimes.maghrib, ramadanState.prayerTimes.sehri, ramadanState.reminderLeadMinutes, ramadanState.remindersEnabled]);

  const selectedPrayerPreset =
    prayerLocationPresets.find((preset) => preset.id === ramadanState.prayerSetup?.presetId) ||
    detectPrayerPreset();

  useEffect(() => {
    window.localStorage.setItem(RAMADAN_STORAGE_KEY, JSON.stringify(ramadanState));
  }, [ramadanState]);

  useEffect(() => {
    if (!ramadanState.remindersEnabled || !nextReminder || Notification.permission !== "granted") {
      return undefined;
    }

    const timeoutMs = Math.max(0, nextReminder.date.getTime() - Date.now());
    const timerId = window.setTimeout(() => {
      new Notification(nextReminder.label, {
        body: `${nextReminder.label} at ${formatTimeLabel(
          nextReminder.id === "sehri" ? ramadanState.prayerTimes.sehri : ramadanState.prayerTimes.maghrib
        )}`
      });
    }, timeoutMs);

    return () => window.clearTimeout(timerId);
  }, [nextReminder, ramadanState.prayerTimes.maghrib, ramadanState.prayerTimes.sehri, ramadanState.remindersEnabled]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadSurah() {
      setSurahReaderState({ loading: true, error: "", verses: [] });

      try {
        let verses = [];

        try {
          const payload = await api.getQuranSurah(selectedSurahNumber, selectedTranslation);
          verses = Array.isArray(payload?.verses) ? payload.verses : [];
        } catch {
          verses = await loadSurahFromClientAssets(selectedSurahNumber, selectedTranslation);
        }

        if (controller.signal.aborted) {
          return;
        }

        setSurahReaderState({
          loading: false,
          error: "",
          verses
        });
      } catch (error) {
        if (error.name === "AbortError") {
          return;
        }

        setSurahReaderState({
          loading: false,
          error: "Surah text could not be loaded right now.",
          verses: []
        });
      }
    }

    loadSurah();

    return () => controller.abort();
  }, [selectedSurahNumber, selectedTranslation]);

  function updatePrayerTime(key, value) {
    setRamadanState((current) => ({
      ...current,
      prayerTimes: {
        ...current.prayerTimes,
        [key]: value
      }
    }));
  }

  function recalculatePrayerTimesFromPreset(presetId) {
    const preset =
      prayerLocationPresets.find((entry) => entry.id === presetId) ||
      detectPrayerPreset();
    const prayerTimes = calculatePrayerTimes({
      latitude: preset.latitude,
      longitude: preset.longitude,
      timeZone: preset.timeZone
    });

    setRamadanState((current) => ({
      ...current,
      prayerTimes,
      prayerSetup: {
        ...current.prayerSetup,
        presetId: preset.id,
        method: "preset",
        timeZone: preset.timeZone,
        label: `${preset.label}, ${preset.country}`,
        lastCalculatedAt: new Date().toISOString()
      }
    }));
    setPrivacyMessage("Prayer times updated locally from your chosen division/city and timezone. Nothing was sent to the server.");
  }

  function useDeviceLocationLocally() {
    if (!navigator.geolocation) {
      setPrivacyMessage("Device location is not available in this browser.");
      return;
    }

    setPrivacyMessage("Requesting location in this browser only. Coordinates will not be saved or sent anywhere.");

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const prayerTimes = calculatePrayerTimes({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          timeZone
        });

        setRamadanState((current) => ({
          ...current,
          prayerTimes,
          prayerSetup: {
            ...current.prayerSetup,
            method: "device-local",
            timeZone,
            label: "Device location (local only)",
            lastCalculatedAt: new Date().toISOString()
          }
        }));
        setPrivacyMessage("Prayer times calculated on this device only. Exact coordinates were not stored.");
      },
      (error) => {
        setPrivacyMessage(
          error.code === error.PERMISSION_DENIED
            ? "Location permission was denied. Your prayer times remain private and unchanged."
            : "Location could not be read. Your prayer times remain private and unchanged."
        );
      },
      {
        enableHighAccuracy: false,
        timeout: 10000,
        maximumAge: 600000
      }
    );
  }

  function toggleDayInList(key, dayNumber) {
    setRamadanState((current) => {
      const list = new Set(current[key] || []);
      if (list.has(dayNumber)) {
        list.delete(dayNumber);
      } else {
        list.add(dayNumber);
      }

      return {
        ...current,
        [key]: [...list].sort((first, second) => first - second)
      };
    });
  }

  function saveJournalEntry() {
    const value = journalDraft.trim();
    if (!value) {
      return;
    }

    setRamadanState((current) => ({
      ...current,
      journalEntries: [
        {
          id: crypto.randomUUID(),
          day: current.ramadanDay,
          text: value,
          createdAt: new Date().toISOString()
        },
        ...current.journalEntries
      ]
    }));
    setJournalDraft("");
  }

  function addCharityEntry() {
    const title = charityDraft.title.trim();
    const amount = charityDraft.amount.trim();
    if (!title || !amount) {
      return;
    }

    setRamadanState((current) => ({
      ...current,
      charityEntries: [
        {
          id: crypto.randomUUID(),
          title,
          amount,
          createdAt: new Date().toISOString()
        },
        ...current.charityEntries
      ]
    }));
    setCharityDraft({ title: "", amount: "" });
  }

  return (
    <main className="ramadan-window-shell">
      <section className="ramadan-window-frame">
        <header className="ramadan-window-head">
          <div className="ramadan-window-title">
            <span className="ramadan-window-badge">Ramadan</span>
            <h1>Ramadan Companion</h1>
            <p>Prayer times, fasting trackers, Quran reading, charity, journal, and reminders in one window.</p>
          </div>
          <div className="ramadan-window-head-actions">
            <div className="ramadan-window-tabset" role="tablist" aria-label="Ramadan app sections">
              {[
                { id: "overview", label: "Overview" },
                { id: "quran", label: "Quran" },
                { id: "journal", label: "Journal" }
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`ramadan-window-tab ${activeTab === tab.id ? "is-active" : ""}`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <button className="ghost-button compact" type="button" onClick={() => window.close()}>
              Close
            </button>
          </div>
        </header>

        {activeTab === "overview" ? (
          <>
            <section className="ramadan-window-hero">
              <div className="ramadan-window-hero-copy">
                <span>Ramadan day</span>
                <div className="ramadan-window-day-row">
                  <h2>Day {String(ramadanState.ramadanDay).padStart(2, "0")}</h2>
                  <input
                    className="ramadan-window-day-input"
                    type="range"
                    min="1"
                    max="30"
                    value={ramadanState.ramadanDay}
                    onChange={(event) =>
                      setRamadanState((current) => ({
                        ...current,
                        ramadanDay: Number.parseInt(event.target.value, 10)
                      }))
                    }
                  />
                </div>
                <p>{dailyAyah}</p>
              </div>
              <div className="quran-window-stats">
                <QuranStat label="Fasts" value={`${completedFasts.length}/30`} />
                <QuranStat label="Juz progress" value={`${ramadanState.quranProgress.completedJuzs}/30`} />
                <QuranStat label="Donated" value={formatCurrency(totalDonated)} />
              </div>
            </section>

            <section className="ramadan-window-grid">
              <div className="ramadan-window-column">
                <div className="ramadan-window-panel">
                  <div className="ramadan-window-panel-head">
                    <strong>Prayer times</strong>
                    <span>Local-only setup</span>
                  </div>
                  <div className="ramadan-window-privacy-box">
                    <strong>Maximum privacy</strong>
                    <p>
                      By default, this app uses your chosen division/city and timezone locally in the browser. Optional device location stays on-device and is never sent to the server or shared with other users.
                    </p>
                  </div>
                  <div className="ramadan-window-setup-grid">
                    <label className="ramadan-window-field">
                      <span>Private division/city</span>
                      <select
                        value={selectedPrayerPreset.id}
                        onChange={(event) => recalculatePrayerTimesFromPreset(event.target.value)}
                      >
                        {prayerLocationPresets.map((preset) => (
                          <option key={preset.id} value={preset.id}>
                            {preset.label}, {preset.country}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="ramadan-window-local-actions">
                      <button type="button" className="ghost-button compact" onClick={() => recalculatePrayerTimesFromPreset(selectedPrayerPreset.id)}>
                        Recalculate Locally
                      </button>
                      <button type="button" className="ghost-button compact is-soft" onClick={useDeviceLocationLocally}>
                        Use Device Location Locally
                      </button>
                    </div>
                  </div>
                  <div className="ramadan-window-setup-meta">
                    <span>Current source: {ramadanState.prayerSetup?.label || "Private manual setup"}</span>
                    <span>Timezone: {ramadanState.prayerSetup?.timeZone || selectedPrayerPreset.timeZone}</span>
                  </div>
                  {privacyMessage ? <p className="ramadan-window-helper">{privacyMessage}</p> : null}
                  <div className="ramadan-window-prayer-grid">
                    {Object.entries(ramadanState.prayerTimes).map(([key, value]) => (
                      <label key={key} className="ramadan-window-prayer-item">
                        <span>{key}</span>
                        <input type="time" value={value} onChange={(event) => updatePrayerTime(key, event.target.value)} />
                      </label>
                    ))}
                  </div>
                  <div className="ramadan-window-reminder-row">
                    <label className="ramadan-window-check">
                      <input
                        type="checkbox"
                        checked={ramadanState.remindersEnabled}
                        onChange={(event) =>
                          setRamadanState((current) => ({
                            ...current,
                            remindersEnabled: event.target.checked
                          }))
                        }
                      />
                      <span>Enable suhoor/iftar reminders</span>
                    </label>
                    <label className="ramadan-window-lead">
                      <span>Lead</span>
                      <input
                        type="number"
                        min="0"
                        max="120"
                        value={ramadanState.reminderLeadMinutes}
                        onChange={(event) =>
                          setRamadanState((current) => ({
                            ...current,
                            reminderLeadMinutes: event.target.value
                          }))
                        }
                      />
                      <span>min</span>
                    </label>
                  </div>
                  <p className="ramadan-window-helper">
                    {nextReminder
                      ? `${nextReminder.label} scheduled for ${new Intl.DateTimeFormat([], {
                          hour: "numeric",
                          minute: "2-digit",
                          hour12: true
                        }).format(nextReminder.date)} while this app stays open.`
                      : "No reminder pending today."}
                  </p>
                </div>

                <div className="ramadan-window-panel">
                  <div className="ramadan-window-panel-head">
                    <strong>Roza tracker</strong>
                    <span>Tap to mark each fast completed</span>
                  </div>
                  <div className="ramadan-window-day-grid">
                    {Array.from({ length: 30 }, (_, index) => index + 1).map((day) => (
                      <button
                        key={day}
                        type="button"
                        className={`ramadan-window-day-chip ${completedFasts.includes(day) ? "is-complete" : ""}`}
                        onClick={() => toggleDayInList("completedFasts", day)}
                      >
                        {day}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="ramadan-window-panel">
                  <div className="ramadan-window-panel-head">
                    <strong>Taraweeh planner</strong>
                    <span>Track each night</span>
                  </div>
                  <div className="ramadan-window-day-grid is-compact">
                    {Array.from({ length: 30 }, (_, index) => index + 1).map((night) => (
                      <button
                        key={night}
                        type="button"
                        className={`ramadan-window-day-chip ${taraweehNights.includes(night) ? "is-complete" : ""}`}
                        onClick={() => toggleDayInList("taraweehNights", night)}
                      >
                        N{night}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="ramadan-window-column">
                <div className="ramadan-window-panel">
                  <div className="ramadan-window-panel-head">
                    <strong>Daily focus</strong>
                    <span>Ayah and dua for today</span>
                  </div>
                  <div className="ramadan-window-card-stack">
                    <RamadanOverviewCard title="Ayah reflection" body={dailyAyah} accent="sky" />
                    <RamadanOverviewCard title="Daily dua" body={dailyDua} accent="gold" />
                  </div>
                </div>

                <div className="ramadan-window-panel">
                  <div className="ramadan-window-panel-head">
                    <strong>Quran progress tracker</strong>
                    <span>Keep your reading target visible</span>
                  </div>
                  <label className="ramadan-window-field">
                    <span>Current juz</span>
                    <input
                      type="range"
                      min="1"
                      max="30"
                      value={ramadanState.quranProgress.currentJuz}
                      onChange={(event) =>
                        setRamadanState((current) => ({
                          ...current,
                          quranProgress: {
                            ...current.quranProgress,
                            currentJuz: Number.parseInt(event.target.value, 10)
                          }
                        }))
                      }
                    />
                  </label>
                  <label className="ramadan-window-field">
                    <span>Completed juz</span>
                    <input
                      type="number"
                      min="0"
                      max="30"
                      value={ramadanState.quranProgress.completedJuzs}
                      onChange={(event) =>
                        setRamadanState((current) => ({
                          ...current,
                          quranProgress: {
                            ...current.quranProgress,
                            completedJuzs: Number.parseInt(event.target.value, 10) || 0
                          }
                        }))
                      }
                    />
                  </label>
                  <label className="ramadan-window-field">
                    <span>Reading note</span>
                    <textarea
                      rows="3"
                      value={ramadanState.quranProgress.note}
                      onChange={(event) =>
                        setRamadanState((current) => ({
                          ...current,
                          quranProgress: {
                            ...current.quranProgress,
                            note: event.target.value
                          }
                        }))
                      }
                    />
                  </label>
                </div>

                <div className="ramadan-window-panel">
                  <div className="ramadan-window-panel-head">
                    <strong>Zakat / charity tracker</strong>
                    <span>{donationProgress}% of goal reached</span>
                  </div>
                  <label className="ramadan-window-field">
                    <span>Goal amount</span>
                    <input
                      type="number"
                      min="0"
                      value={ramadanState.charityGoal}
                      onChange={(event) =>
                        setRamadanState((current) => ({
                          ...current,
                          charityGoal: event.target.value
                        }))
                      }
                    />
                  </label>
                  <div className="ramadan-window-inline-form">
                    <input
                      type="text"
                      placeholder="Donation note"
                      value={charityDraft.title}
                      onChange={(event) => setCharityDraft((current) => ({ ...current, title: event.target.value }))}
                    />
                    <input
                      type="number"
                      min="0"
                      placeholder="Amount"
                      value={charityDraft.amount}
                      onChange={(event) => setCharityDraft((current) => ({ ...current, amount: event.target.value }))}
                    />
                    <button type="button" className="ghost-button compact" onClick={addCharityEntry}>
                      Add
                    </button>
                  </div>
                  <div className="ramadan-window-log">
                    {charityEntries.length ? (
                      charityEntries.map((entry) => (
                        <div key={entry.id} className="ramadan-window-log-row">
                          <strong>{entry.title}</strong>
                          <span>{formatCurrency(entry.amount)}</span>
                        </div>
                      ))
                    ) : (
                      <p className="ramadan-window-helper">No charity logged yet.</p>
                    )}
                  </div>
                </div>
              </div>
            </section>
          </>
        ) : null}

        {activeTab === "quran" ? (
          <>
            <section className="quran-window-hero">
              <div className="quran-window-hero-copy">
                <span>Selected surah</span>
                <h2>{selectedSurah.name}</h2>
                <p className="quran-window-arabic">{selectedSurah.arabicName}</p>
                <p>
                  Surah {selectedSurah.number} · {selectedSurah.revelationType} · {selectedSurah.ayahCount} ayahs
                </p>
              </div>
              <div className="quran-window-stats">
                <QuranStat label="Surahs" value="114" />
                <QuranStat label="Ayahs" value="6,236" />
                <QuranStat label="Selected" value={String(selectedSurah.number).padStart(3, "0")} />
              </div>
            </section>

            <section className="quran-window-grid">
              <aside className="quran-window-sidebar">
                <label className="quran-window-search">
                  <span aria-hidden="true">⌕</span>
                  <input
                    type="search"
                    placeholder="Search surah by name or number"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </label>

                <div className="quran-window-list" role="list" aria-label="All Quran surahs">
                  {filteredSurahs.map((surah) => (
                    <button
                      key={surah.number}
                      type="button"
                      className={`quran-window-row ${surah.number === selectedSurah.number ? "is-active" : ""}`}
                      onClick={() => setSelectedSurahNumber(surah.number)}
                    >
                      <span className="quran-window-row-number">{surah.number}</span>
                      <span className="quran-window-row-copy">
                        <strong>{surah.name}</strong>
                        <span>{surah.revelationType}</span>
                      </span>
                      <span className="quran-window-row-meta">
                        <span className="quran-window-row-arabic">{surah.arabicName}</span>
                        <span>{surah.ayahCount} ayahs</span>
                      </span>
                    </button>
                  ))}
                </div>
              </aside>

              <section className="quran-window-detail">
                <div className="quran-window-detail-card">
                  <div className="quran-window-detail-head">
                    <span>Surah {selectedSurah.number}</span>
                    <span>{selectedSurah.revelationType}</span>
                  </div>
                  <div className="quran-window-detail-title-row">
                    <div>
                      <h3>{selectedSurah.name}</h3>
                      <p className="quran-window-detail-copy">Read and reflect without leaving the Ramadan workspace.</p>
                    </div>
                    <p className="quran-window-arabic is-large">{selectedSurah.arabicName}</p>
                  </div>
                  <label className="quran-window-translation-picker">
                    <span>Translation</span>
                    <select
                      value={selectedTranslation}
                      onChange={(event) => setSelectedTranslation(event.target.value)}
                    >
                      <option value="en.asad">Muhammad Asad</option>
                      <option value="en.sahih">Sahih International</option>
                      <option value="bn.bengali">Bengali</option>
                    </select>
                  </label>
                </div>

                <div className="quran-window-reader">
                  <div className="quran-window-reader-head">
                    <strong>Reader</strong>
                    <span>{surahReaderState.verses.length || selectedSurah.ayahCount} ayahs</span>
                  </div>

                  {surahReaderState.loading ? (
                    <p className="quran-window-reader-state">Loading surah text...</p>
                  ) : null}

                  {!surahReaderState.loading && surahReaderState.error ? (
                    <p className="quran-window-reader-state is-error">{surahReaderState.error}</p>
                  ) : null}

                  {!surahReaderState.loading && !surahReaderState.error ? (
                    <div className="quran-window-ayah-list">
                      {surahReaderState.verses.map((verse) => (
                        <article key={verse.numberInSurah} className="quran-window-ayah-card">
                          <div className="quran-window-ayah-head">
                            <span>Ayah {verse.numberInSurah}</span>
                            <span>Juz {verse.juz} · Page {verse.page}</span>
                          </div>
                          <p className="quran-window-ayah-arabic">{verse.arabicText}</p>
                          {verse.translationText ? (
                            <p className="quran-window-ayah-translation">{verse.translationText}</p>
                          ) : null}
                        </article>
                      ))}
                    </div>
                  ) : null}
                </div>
              </section>
            </section>
          </>
        ) : null}

        {activeTab === "journal" ? (
          <section className="ramadan-window-grid">
            <div className="ramadan-window-column">
              <div className="ramadan-window-panel">
                <div className="ramadan-window-panel-head">
                  <strong>Ramadan journal</strong>
                  <span>Capture what mattered today</span>
                </div>
                <label className="ramadan-window-field">
                  <span>Write for day {ramadanState.ramadanDay}</span>
                  <textarea rows="8" value={journalDraft} onChange={(event) => setJournalDraft(event.target.value)} />
                </label>
                <button type="button" className="ghost-button compact" onClick={saveJournalEntry}>
                  Save entry
                </button>
              </div>
            </div>

            <div className="ramadan-window-column">
              <div className="ramadan-window-panel">
                <div className="ramadan-window-panel-head">
                  <strong>Saved reflections</strong>
                  <span>{journalEntries.length} entries</span>
                </div>
                <div className="ramadan-window-log is-journal">
                  {journalEntries.length ? (
                    journalEntries.map((entry) => (
                      <article key={entry.id} className="ramadan-window-journal-entry">
                        <div className="ramadan-window-journal-head">
                          <strong>Day {entry.day}</strong>
                          <span>{new Date(entry.createdAt).toLocaleDateString()}</span>
                        </div>
                        <p>{entry.text}</p>
                      </article>
                    ))
                  ) : (
                    <p className="ramadan-window-helper">No journal entries saved yet.</p>
                  )}
                </div>
              </div>
            </div>
          </section>
        ) : null}
      </section>
    </main>
  );
}
