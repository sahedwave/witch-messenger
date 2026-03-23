import { useEffect, useMemo, useState } from "react";

import { api } from "../api";
import { quranSurahs } from "../quran-data";

const translationAssetMap = {
  "en.asad": "/quran/en-asad.json",
  "en.sahih": "/quran/en-sahih.json",
  "bn.bengali": "/quran/bn-bengali.json"
};

const quranAssetCache = new Map();

async function readClientDataset(assetPath) {
  if (quranAssetCache.has(assetPath)) {
    return quranAssetCache.get(assetPath);
  }

  const response = await fetch(assetPath);

  if (!response.ok) {
    throw new Error("Unable to load local Quran dataset.");
  }

  const payload = await response.json();
  quranAssetCache.set(assetPath, payload);
  return payload;
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

export function QuranWindow() {
  const [search, setSearch] = useState("");
  const [selectedSurahNumber, setSelectedSurahNumber] = useState(1);
  const [selectedTranslation, setSelectedTranslation] = useState("en.asad");
  const [surahReaderState, setSurahReaderState] = useState({
    loading: true,
    error: "",
    verses: []
  });

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

  return (
    <main className="quran-window-shell">
      <section className="quran-window-frame">
        <header className="quran-window-head">
          <div className="quran-window-title">
            <span className="quran-window-badge">Quran</span>
            <h1>Al Quran</h1>
            <p>Browse all 114 surahs in a dedicated reader window.</p>
          </div>
          <div className="quran-window-head-actions">
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
            <button
              className="ghost-button compact"
              type="button"
              onClick={() => window.close()}
            >
              Close
            </button>
          </div>
        </header>

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
              <h3>{selectedSurah.name}</h3>
              <p className="quran-window-arabic is-large">{selectedSurah.arabicName}</p>
              <p>
                This window keeps the Quran separate from the chat workspace, so reading stays focused and uncluttered.
              </p>
            </div>

            <div className="quran-window-insight-grid">
              <div className="quran-window-insight-card">
                <span>Ayah count</span>
                <strong>{selectedSurah.ayahCount}</strong>
              </div>
              <div className="quran-window-insight-card">
                <span>Revelation</span>
                <strong>{selectedSurah.revelationType}</strong>
              </div>
              <div className="quran-window-insight-card">
                <span>Arabic title</span>
                <strong className="quran-window-arabic">{selectedSurah.arabicName}</strong>
              </div>
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
      </section>
    </main>
  );
}
