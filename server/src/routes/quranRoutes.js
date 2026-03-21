import express from "express";
import { readFile } from "node:fs/promises";

const router = express.Router();
const ALLOWED_TRANSLATIONS = new Set(["en.asad", "en.sahih", "bn.bengali"]);
const DATASET_PATHS = {
  "quran-uthmani": new URL("../data/quran/quran-uthmani.json", import.meta.url),
  "en.asad": new URL("../data/quran/en-asad.json", import.meta.url),
  "en.sahih": new URL("../data/quran/en-sahih.json", import.meta.url),
  "bn.bengali": new URL("../data/quran/bn-bengali.json", import.meta.url)
};
const datasetCache = new Map();

async function loadDataset(identifier) {
  if (datasetCache.has(identifier)) {
    return datasetCache.get(identifier);
  }

  const fileUrl = DATASET_PATHS[identifier];

  if (!fileUrl) {
    throw new Error(`Unknown Quran dataset: ${identifier}`);
  }

  const raw = await readFile(fileUrl, "utf8");
  const parsed = JSON.parse(raw);
  datasetCache.set(identifier, parsed);
  return parsed;
}

router.get("/surah/:surahNumber", async (req, res, next) => {
  try {
    const surahNumber = Number.parseInt(req.params.surahNumber, 10);
    const requestedTranslation = typeof req.query.translation === "string" ? req.query.translation : "en.asad";
    const translation = ALLOWED_TRANSLATIONS.has(requestedTranslation) ? requestedTranslation : "en.asad";

    if (!Number.isInteger(surahNumber) || surahNumber < 1 || surahNumber > 114) {
      return res.status(400).json({ message: "Valid surah number required." });
    }

    const [arabicDataset, translationDataset] = await Promise.all([
      loadDataset("quran-uthmani"),
      loadDataset(translation)
    ]);
    const arabicSurah = arabicDataset?.data?.surahs?.[surahNumber - 1];
    const translatedSurah = translationDataset?.data?.surahs?.[surahNumber - 1];
    const arabicAyahs = Array.isArray(arabicSurah?.ayahs) ? arabicSurah.ayahs : [];
    const translatedAyahs = Array.isArray(translatedSurah?.ayahs) ? translatedSurah.ayahs : [];

    const verses = arabicAyahs.map((ayah, index) => ({
      numberInSurah: ayah.numberInSurah,
      arabicText: ayah.text,
      translationText: translatedAyahs[index]?.text || "",
      juz: ayah.juz,
      page: ayah.page
    }));

    return res.json({
      surahNumber,
      translation,
      verses
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
